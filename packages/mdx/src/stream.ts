import type { Diagnostic } from "./diagnostics.ts";
import type { FootnoteReferenceNode, MdxNode } from "./model.ts";
import type { BlockSyntax } from "./parser/block-syntax.ts";
import type { ParserLimit } from "./parser/config.ts";
import type { MaterializeCache, MaterializedBlock } from "./parser/materialize.ts";
import type {
  BlockId,
  MdxEdit,
  MdxStreamCompletion,
  MdxStreamOptions,
  MdxStreamSnapshot,
  OwnedBlock,
  StreamingBlockSnapshot,
} from "./stream-types.ts";
import type { StreamingDocument, StreamingNode } from "./streaming-document.ts";

import { createDiagnostic, hasErrorDiagnostics } from "./diagnostics.ts";
import { ConfigurationError, InputError } from "./errors.ts";
import { createBlockHtmlRenderer, createHtmlLoweringCache } from "./html-lower.ts";
import { resolveParserLimits } from "./parser/config.ts";
import { createMaterializeCache, materializeStrictDocument } from "./parser/materialize.ts";
import { ParserSession } from "./parser/session.ts";
import { rangesIntersect, shiftRange } from "./ranges.ts";
import { SourceFile } from "./source.ts";
import {
  applyPendingBlock,
  authoredStreamingDocument,
  dependenciesFor,
  nodeReferences,
  projectPendingDocument,
  streamingDocumentFromHtml,
  strictBlockDocument,
  trimStreamingTail,
  type NodeReferences,
  type StreamingConversionCache,
} from "./stream-materialize.ts";

export type {
  BlockId,
  CompletedBlockSnapshot,
  MdxEdit,
  MdxStreamCompletion,
  MdxStreamOptions,
  MdxStreamSnapshot,
  StreamDependencies,
  StreamingBlockSnapshot,
} from "./stream-types.ts";

const defaultMaximumPendingBlockLength = 4 * 1024 * 1024;

interface StreamChange {
  readonly edit: MdxEdit;
  readonly append: boolean;
}

/** Owns parser state and source-independent rendering caches for one document. */
export class MdxStream {
  readonly #limits;
  readonly #maximumPendingBlockLength: number;
  readonly #session: ParserSession;
  #file: SourceFile;
  #blocks: readonly OwnedBlock[] = [];
  #current: MdxStreamSnapshot;
  #completion: Extract<MdxStreamCompletion, { kind: "ok" }> | undefined;
  #definitions: ReadonlyMap<string, string> = new Map();
  #nextId = 0;
  readonly #definitionsByBlock = new WeakMap<BlockSyntax, readonly DefinitionDraft[]>();
  readonly #signatures = new WeakMap<BlockSyntax, string>();
  readonly #snapshots = new WeakMap<OwnedBlock, StreamingBlockSnapshot>();
  #materializeCache: MaterializeCache = createMaterializeCache();
  #lowered = createHtmlLoweringCache();
  #converted: StreamingConversionCache = new WeakMap();
  readonly #references = new WeakMap<MdxNode, NodeReferences>();
  #supplementKey = "";
  #supplement: StreamingDocument = { kind: "root", children: [] };

  public constructor(options: MdxStreamOptions = {}) {
    this.#limits = resolveParserLimits(options.limits);
    const maximum = options.maximumPendingBlockLength ?? defaultMaximumPendingBlockLength;

    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      ConfigurationError.invalidStreamLimit("maximumPendingBlockLength", maximum, 1);
    }

    this.#maximumPendingBlockLength = maximum;
    this.#file =
      options.source instanceof SourceFile ? options.source : new SourceFile(options.source ?? "");
    this.#session = new ParserSession({
      source: this.#file,
      syntax: options.syntax,
      limits: options.limits,
    });
    this.#current = this.parseStreaming();
  }

  public append(text: string): MdxStreamSnapshot {
    this.assertOpen();

    if (text.length === 0) {
      return this.#current;
    }

    const start = this.#file.text.length;

    return this.applyEdit({ start, end: start, text }, true);
  }

  public edit(edit: MdxEdit): MdxStreamSnapshot {
    this.assertOpen();

    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > this.#file.text.length
    ) {
      InputError.replacementRangeOutsideSource(edit.start, edit.end, this.#file.text.length);
    }

    return this.applyEdit(edit, false);
  }

  public snapshot(): MdxStreamSnapshot | MdxStreamCompletion {
    return this.#completion ?? this.#current;
  }

  public complete(): MdxStreamCompletion {
    if (this.#completion !== undefined) {
      return this.#completion;
    }

    if (this.#file.text.length > this.#limits.maximumSourceLength) {
      return this.limitCompletion("maximumSourceLength", this.#file.text.length);
    }

    const draft = this.#session.finalDraft();

    // Always bind the public strict tree to the final source version.
    const parsed = materializeStrictDocument(
      draft.file,
      draft.blocks,
      this.#session.syntax,
      this.#session.limits,
    );

    if (parsed.kind !== "ok") {
      return Object.freeze({ ...parsed, file: draft.file });
    }

    const previous = new Map(this.#blocks.map((block) => [block.range.start, block]));

    const blocks = parsed.blocks.map(({ node, candidates }) => {
      const start = lineStart(draft.file.text, node.origin?.start ?? 0);

      return Object.freeze({
        id: previous.get(start)?.id ?? this.newBlockId(),
        range: Object.freeze({ start, end: node.origin?.end ?? start }),
        dependencies: dependenciesFor(nodeReferences(node, this.#references), candidates),
        document: strictBlockDocument(node, parsed.document),
      });
    });

    this.#completion = Object.freeze({
      kind: "ok",
      file: draft.file,
      document: parsed.document,
      blocks: Object.freeze(blocks),
      diagnostics: parsed.diagnostics,
    });
    this.#session.makeTerminal();

    return this.#completion;
  }

  private applyEdit(edit: MdxEdit, append: boolean): MdxStreamSnapshot {
    const text = this.#file.text.slice(0, edit.start) + edit.text + this.#file.text.slice(edit.end);

    if (append) {
      this.#session.append(edit.text);
    } else {
      this.#session.edit(edit);
    }

    this.#file = new SourceFile({ text, name: this.#file.name });
    this.#current = this.parseStreaming({ edit, append });

    return this.#current;
  }

  private parseStreaming(change?: StreamChange): MdxStreamSnapshot {
    const retained = (): ReadonlyMap<string, OwnedBlock> => this.retainedBlocks(change, 0);

    if (this.#file.text.length > this.#limits.maximumSourceLength) {
      return this.limitSnapshot(retained(), "maximumSourceLength", this.#file.text.length);
    }

    const draft = this.#session.finalDraft();

    const pending = draft.pending;

    const pendingOwner =
      pending === undefined
        ? undefined
        : draft.blocks.find(
            (block) =>
              block.range.start <= pending.range.start && block.range.end >= pending.range.end,
          );

    if (
      pendingOwner !== undefined &&
      pendingOwner.range.end - pendingOwner.range.start > this.#maximumPendingBlockLength
    ) {
      return this.limitSnapshot(retained(), "maximumPendingBlockLength", pendingOwner.range.end);
    }

    const definitions = this.definitionDrafts(draft.blocks);

    const signatures = new Map(
      definitions.map((block) => [
        `${block.kind}:${block.identifier}`,
        this.#file.slice(block.range),
      ]),
    );

    const changed = new Set(
      [...this.#definitions.keys(), ...signatures.keys()].filter(
        (key) => this.#definitions.get(key) !== signatures.get(key),
      ),
    );

    // Reference resolution depends on the defined identifiers.
    if (changed.size > 0) {
      this.#materializeCache = createMaterializeCache();
    }

    // Context is materialized once; ordinary settled blocks need no semantic nodes.
    const materializeLimits = this.#limits;

    const context = materializeStrictDocument(
      this.#file,
      definitions,
      this.#session.syntax,
      materializeLimits,
      true,
    );

    if (context.kind !== "ok") {
      return context.kind === "limitExceeded"
        ? this.limitSnapshot(retained(), context.limit, this.#file.text.length)
        : this.invalidSnapshot(retained(), context.diagnostics);
    }

    const contextNodeCount =
      1 + context.blocks.reduce((count, block) => count + block.nodeCount, 0);

    let remainingNodes = this.#limits.maximumNodes - 1;
    const materialized = new Map<BlockSyntax, MaterializedBlock>();
    const blocks: OwnedBlock[] = [];
    let reused = 0;

    // Appends cannot change settled blocks, so their parser output is reused by identity.
    if (change?.append === true && changed.size === 0) {
      const previous = this.#blocks;

      while (
        reused < previous.length - 1 &&
        reused < draft.blocks.length - 1 &&
        previous[reused].syntax === draft.blocks[reused] &&
        previous[reused].pendingKey === "" &&
        previous[reused].diagnostics.length === 0
      ) {
        remainingNodes -= previous[reused].nodeCount;
        blocks.push(previous[reused]);
        reused++;
      }

      if (remainingNodes < 0) {
        return this.limitSnapshot(retained(), "maximumNodes", draft.blocks[reused].range.end);
      }
    }

    const tail = this.retainedBlocks(change, reused);

    for (const syntax of draft.blocks.slice(reused)) {
      const start = lineStart(this.#file.text, syntax.range.start);
      const range = { start, end: syntax.range.end };
      const old = tail.get(rangeKey(range.start, range.end));

      const active =
        change?.append === true && this.#blocks.at(-1)?.range.start === start
          ? this.#blocks.at(-1)
          : undefined;

      const pendingKey =
        draft.pending !== undefined &&
        draft.pending.range.start >= syntax.range.start &&
        draft.pending.range.end <= syntax.range.end
          ? JSON.stringify(draft.pending)
          : "";

      const sameSyntax =
        old !== undefined &&
        !old.moved &&
        (old.syntax === syntax || this.signature(old.syntax) === this.signature(syntax));

      const dependenciesChanged =
        old !== undefined &&
        (old.dependencies.definitions.some((id) => changed.has(`definition:${id}`)) ||
          old.dependencies.footnotes.some((id) => changed.has(`footnoteDefinition:${id}`)));

      if (
        old !== undefined &&
        sameSyntax &&
        old.pendingKey === pendingKey &&
        !dependenciesChanged &&
        old.diagnostics.length === 0
      ) {
        remainingNodes -= old.nodeCount;

        if (remainingNodes < 0) {
          return this.limitSnapshot(retained(), "maximumNodes", syntax.range.end);
        }

        // Adopt the settled parser output so later appends can reuse the block by identity.
        blocks.push(old.syntax === syntax ? old : { ...old, syntax });
        continue;
      }

      const result = materializeStrictDocument(
        this.#file,
        [...definitions, syntax],
        this.#session.syntax,
        { ...materializeLimits, maximumNodes: remainingNodes + contextNodeCount },
        true,
        this.#materializeCache,
      );

      if (result.kind === "limitExceeded") {
        return this.limitSnapshot(retained(), result.limit, syntax.range.end);
      }

      if (result.kind === "invalid") {
        // One invalid block stays inert while the rest of the document keeps streaming.
        blocks.push({
          id: old?.id ?? active?.id ?? this.newBlockId(),
          range: Object.freeze(range),
          syntax,
          moved: false,
          pendingKey,
          dependencies: Object.freeze({ definitions: [], footnotes: [] }),
          candidates: [],
          references: [],
          referenceContext: "",
          nodeCount: 0,
          diagnostics: result.diagnostics,
          streaming: authoredStreamingDocument(this.#file, range),
        });
        continue;
      }

      const block = result.blocks.at(-1);

      if (block === undefined) {
        continue;
      }

      materialized.set(syntax, block);
      const nodeCount = block.nodeCount;
      const collected = nodeReferences(block.node, this.#references);

      const references = collected.footnoteReferences.flatMap((node) =>
        node.origin === undefined
          ? []
          : [{ identifier: node.identifier, start: node.origin.start, end: node.origin.end }],
      );

      remainingNodes -= nodeCount;

      if (remainingNodes < 0) {
        return this.limitSnapshot(retained(), "maximumNodes", syntax.range.end);
      }

      blocks.push({
        id: old?.id ?? active?.id ?? this.newBlockId(),
        range: Object.freeze(range),
        syntax,
        moved: false,
        pendingKey,
        dependencies: dependenciesFor(collected, block.candidates),
        candidates: block.candidates,
        references,
        referenceContext: "",
        nodeCount,
        diagnostics: result.diagnostics,
        streaming: { kind: "root", children: [] },
      });
    }

    const references = blocks.flatMap((block) => block.references);

    const supplementKey = JSON.stringify([
      references,
      definitions.map((block) => [
        block.kind,
        block.identifier,
        block.range,
        this.#file.slice(block.range),
      ]),
    ]);

    // Lowered HTML depends on definitions and footnote numbering.
    if (supplementKey !== this.#supplementKey) {
      this.#lowered = createHtmlLoweringCache();
      this.#converted = new WeakMap();
    }

    const renderer = createBlockHtmlRenderer(
      context.document,
      {},
      references.map((reference): FootnoteReferenceNode => ({
        kind: "footnoteReference",
        identifier: reference.identifier,
        label: reference.identifier,
        origin: { start: reference.start, end: reference.end },
      })),
      this.#lowered,
    );

    const rendered = blocks.map((block): OwnedBlock => {
      const unchanged = !materialized.has(block.syntax);

      // A block without footnote references keeps its rendering until it changes.
      if (
        hasErrorDiagnostics(block.diagnostics) ||
        (unchanged && block.references.length === 0 && block.referenceContext !== "")
      ) {
        return block;
      }

      const referenceContext = renderer.referenceContext(block.references);
      let current = materialized.get(block.syntax);

      if (current === undefined && block.referenceContext === referenceContext) {
        return block;
      }

      if (current === undefined) {
        const result = materializeStrictDocument(
          this.#file,
          [...definitions, block.syntax],
          this.#session.syntax,
          { ...materializeLimits, maximumNodes: block.nodeCount + contextNodeCount },
          true,
          this.#materializeCache,
        );

        if (result.kind !== "ok" || result.blocks.at(-1) === undefined) {
          throw new Error("Retained block changed while updating its footnote context");
        }

        current = result.blocks.at(-1);
      }

      if (current === undefined) {
        throw new Error("Missing materialized stream block");
      }

      return {
        ...block,
        referenceContext,
        streaming: streamingDocumentFromHtml(
          renderer.render([current.node]),
          this.#file.text,
          current.candidates,
          this.#converted,
        ),
      };
    });

    let supplement = this.#supplement;

    if (supplementKey !== this.#supplementKey) {
      const footnotes = renderer.footnotes();
      supplement = streamingDocumentFromHtml(
        footnotes === undefined ? [] : [footnotes],
        this.#file.text,
        [],
      );
    }

    const settledSupplement = supplement;
    let next: readonly OwnedBlock[] = rendered;

    if (draft.pending !== undefined) {
      next = applyPendingBlock(
        next,
        draft.pending,
        this.#file,
        this.#session.syntax,
        this.#session.limits,
      );
      supplement = projectPendingDocument(
        supplement,
        draft.pending,
        this.#file,
        this.#session.syntax,
        this.#session.limits,
      );
    }

    this.#definitions = signatures;
    this.#supplement = settledSupplement;
    this.#supplementKey = supplementKey;
    this.#blocks = next;
    const diagnostics = Object.freeze(next.flatMap((block) => block.diagnostics));

    const snapshots = Object.freeze(
      next.map((block, index) =>
        index === next.length - 1
          ? streamingBlock({ ...block, streaming: trimStreamingTail(block.streaming) })
          : this.blockSnapshot(block),
      ),
    );

    const children: StreamingNode[] = [];

    for (const document of [...snapshots.map((block) => block.document), supplement]) {
      if (document.children.length > 0) {
        if (children.length > 0) {
          children.push(Object.freeze({ kind: "text", value: "\n" }));
        }

        children.push(...document.children);
      }
    }

    return Object.freeze<MdxStreamSnapshot>({
      kind: "preview",
      file: this.#file,
      supplement,
      document: { kind: "root", children },
      blocks: snapshots,
      diagnostics,
      status: hasErrorDiagnostics(diagnostics) ? "invalid" : "valid",
    });
  }

  /** Previous blocks from `from`, keyed by their range after the change. */
  private retainedBlocks(change: StreamChange | undefined, from: number): Map<string, OwnedBlock> {
    const retained = new Map<string, OwnedBlock>();

    for (const block of this.#blocks.slice(from)) {
      if (change === undefined) {
        retained.set(rangeKey(block.range.start, block.range.end), block);
        continue;
      }

      const { edit } = change;

      if (rangesIntersect(block.range, edit)) {
        continue;
      }

      const delta = edit.text.length - (edit.end - edit.start);
      const shift = block.range.start >= edit.end ? delta : 0;

      // Keep identity through shifted edits, but force fresh materialization.
      const moved =
        shift === 0
          ? block
          : { ...block, range: Object.freeze(shiftRange(block.range, shift)), moved: true };

      retained.set(rangeKey(moved.range.start, moved.range.end), moved);
    }

    return retained;
  }

  private limitCompletion(
    limit: ParserLimit,
    offset: number,
  ): Extract<MdxStreamCompletion, { kind: "limitExceeded" }> {
    const diagnostic = createDiagnostic({
      code: "mdx-limit-exceeded",
      severity: "error",
      message: `${limit} was exceeded at source offset ${offset}`,
      span: { file: this.#file, start: offset, end: offset },
    });

    return Object.freeze({
      kind: "limitExceeded",
      file: this.#file,
      limit,
      diagnostics: Object.freeze([diagnostic] as const),
    });
  }

  private limitSnapshot(
    retained: ReadonlyMap<string, OwnedBlock>,
    limit: ParserLimit,
    offset: number,
  ): MdxStreamSnapshot {
    return this.failedSnapshot(
      retained,
      "limitExceeded",
      this.limitCompletion(limit, offset).diagnostics,
    );
  }

  private invalidSnapshot(
    retained: ReadonlyMap<string, OwnedBlock>,
    diagnostics: readonly Diagnostic[],
  ): MdxStreamSnapshot {
    return this.failedSnapshot(retained, "invalid", diagnostics);
  }

  /** Keeps the last valid preview and the block identities that survived the change. */
  private failedSnapshot(
    retained: ReadonlyMap<string, OwnedBlock>,
    status: "invalid" | "limitExceeded",
    diagnostics: readonly Diagnostic[],
  ): MdxStreamSnapshot {
    this.#blocks = [...retained.values()];

    return Object.freeze<MdxStreamSnapshot>({
      kind: "preview",
      file: this.#file,
      supplement: this.#current?.supplement ?? { kind: "root", children: [] },
      document: this.#current?.document ?? { kind: "root", children: [] },
      blocks: this.#current?.blocks ?? Object.freeze([]),
      diagnostics,
      status,
    });
  }

  /** The first definition per identifier. Settled blocks reuse their collected definitions. */
  private definitionDrafts(blocks: readonly BlockSyntax[]): DefinitionDraft[] {
    const definitions = new Map<string, DefinitionDraft>();

    for (const block of blocks) {
      let collected = this.#definitionsByBlock.get(block);

      if (collected === undefined) {
        const found: DefinitionDraft[] = [];
        collectDefinitions(block, found);
        collected = found;
        this.#definitionsByBlock.set(block, collected);
      }

      for (const definition of collected) {
        const key = `${definition.kind}:${definition.identifier}`;

        if (!definitions.has(key)) {
          definitions.set(key, definition);
        }
      }
    }

    return [...definitions.values()];
  }

  /** Unchanged blocks keep their snapshot object, so consumers can compare by identity. */
  private blockSnapshot(block: OwnedBlock): StreamingBlockSnapshot {
    let snapshot = this.#snapshots.get(block);

    if (snapshot === undefined) {
      snapshot = streamingBlock(block);
      this.#snapshots.set(block, snapshot);
    }

    return snapshot;
  }

  /** Structural identity for parser output that was rebuilt after an edit. */
  private signature(syntax: BlockSyntax): string {
    let signature = this.#signatures.get(syntax);

    if (signature === undefined) {
      signature = JSON.stringify(syntax);
      this.#signatures.set(syntax, signature);
    }

    return signature;
  }

  private newBlockId(): BlockId {
    const value = `block-${this.#nextId++}`;

    if (!isBlockId(value)) {
      throw new Error("Internal block identity invariant failed");
    }

    return value;
  }

  private assertOpen(): void {
    if (this.#completion !== undefined) {
      InputError.streamCompleted();
    }
  }
}

type DefinitionDraft = Extract<BlockSyntax, { kind: "definition" | "footnoteDefinition" }>;

/** Collects reference and footnote definitions in one block, in document order. */
function collectDefinitions(block: BlockSyntax, definitions: DefinitionDraft[]): void {
  if (block.kind === "definition" || block.kind === "footnoteDefinition") {
    definitions.push(block);
  }

  if ("children" in block) {
    block.children.forEach((child) => collectDefinitions(child, definitions));
  } else if (block.kind === "list") {
    block.items.forEach((item) =>
      item.children.forEach((child) => collectDefinitions(child, definitions)),
    );
  }
}

/** The start of the physical line containing `offset`. */
function lineStart(text: string, offset: number): number {
  let start = offset;

  while (start > 0 && text[start - 1] !== "\n" && text[start - 1] !== "\r") {
    start--;
  }

  return start;
}

function rangeKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function streamingBlock(block: OwnedBlock): StreamingBlockSnapshot {
  return Object.freeze({
    id: block.id,
    range: block.range,
    dependencies: block.dependencies,
    document: block.streaming,
  });
}

function isBlockId(value: string): value is BlockId {
  return /^block-\d+$/u.test(value);
}
