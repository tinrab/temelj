import type { Diagnostic } from "./diagnostics.ts";
import type { DocumentNode, MdxNode } from "./model.ts";
import type { BlockSyntax } from "./parser/block-syntax.ts";
import type { ParserLimit } from "./parser/config.ts";
import type { MaterializedBlock } from "./parser/materialize.ts";
import type {
  BlockId,
  MdxEdit,
  MdxStreamCompletion,
  MdxStreamOptions,
  MdxStreamSnapshot,
  OwnedBlock,
  StreamingBlockSnapshot,
} from "./stream-types.ts";

import { createDiagnostic } from "./diagnostics.ts";
import { ConfigurationError, InputError } from "./errors.ts";
import { ParagraphNode, TextNode } from "./model.ts";
import { resolveParserLimits } from "./parser/config.ts";
import { materializeStrictDocument } from "./parser/materialize.ts";
import { ParserSession } from "./parser/session.ts";
import { rangesIntersect } from "./ranges.ts";
import { SourceFile } from "./source.ts";
import {
  applyAmbiguousMarkerBlock,
  applyPendingBlock,
  dependenciesFor,
  pendingStreamingDocument,
  streamingDocument,
  streamingDocuments,
  strictBlockDocument,
} from "./stream-materialize.ts";
import { StreamingDocument } from "./streaming-document.ts";

export type {
  BlockId,
  CompletedBlockSnapshot,
  MdxEdit,
  MdxStreamCompletion,
  MdxStreamOptions,
  MdxStreamSnapshot,
  StreamingBlockSnapshot,
} from "./stream-types.ts";

const defaultMaximumPendingBlockLength = 4 * 1024 * 1024;
const emptyDependencies = Object.freeze({
  definitions: Object.freeze([]),
  footnotes: Object.freeze([]),
});

export class MdxStream {
  readonly #limits;
  readonly #maximumPendingBlockLength: number;
  readonly #session: ParserSession;
  #file: SourceFile;
  #blocks: readonly OwnedBlock[] = [];
  #current: MdxStreamSnapshot;
  #completion: Extract<MdxStreamCompletion, { kind: "parsed" }> | undefined;
  #definitionSignatures: ReadonlyMap<string, string> = new Map();
  #footnoteSignatures: ReadonlyMap<string, string> = new Map();
  #nextId = 0;
  #pendingLineage: Readonly<{ id: BlockId; start: number }> | undefined;
  #streamingSupplement = new StreamingDocument([]);

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
    const parsed = materializeStrictDocument(
      draft.file,
      draft.blocks,
      this.#session.syntax,
      this.#session.limits,
    );
    if (parsed.kind === "parsed") {
      const blocks = this.materializeBlocks(parsed.document, parsed.blocks);
      const completion: Extract<MdxStreamCompletion, { kind: "parsed" }> = Object.freeze({
        kind: "parsed",
        file: draft.file,
        document: parsed.document,
        blocks: Object.freeze(
          blocks.map((block) =>
            Object.freeze({
              id: block.id,
              range: block.range,
              dependencies: block.dependencies,
              document: strictBlockDocument(block.node, parsed.document),
            }),
          ),
        ),
        diagnostics: parsed.diagnostics,
      });
      this.#blocks = blocks;
      this.#session.makeTerminal();
      this.#completion = completion;
      return completion;
    }
    return parsed.kind === "invalid"
      ? Object.freeze({ kind: "invalid", file: draft.file, diagnostics: parsed.diagnostics })
      : Object.freeze({
          kind: "limitExceeded",
          file: draft.file,
          limit: parsed.limit,
          diagnostics: parsed.diagnostics,
        });
  }

  private applyEdit(edit: MdxEdit, append: boolean): MdxStreamSnapshot {
    const previous = this.#file;
    const text = previous.text.slice(0, edit.start) + edit.text + previous.text.slice(edit.end);
    if (append) {
      this.#session.append(edit.text);
    } else {
      this.#session.edit(edit);
    }
    this.#file = new SourceFile({ text, name: previous.name });
    if (append && this.appendPlainTextPreview(edit)) {
      return this.#current;
    }
    this.#current = this.parseStreaming({ edit, append });
    return this.#current;
  }

  private appendPlainTextPreview(edit: MdxEdit): boolean {
    if (
      this.#file.text.length > this.#limits.maximumSourceLength ||
      !/^[\p{L}\p{N} ]+$/u.test(edit.text) ||
      this.#current.status !== "valid"
    ) {
      return false;
    }
    const active = this.#blocks.at(-1);
    if (active === undefined || active.range.end !== edit.start) {
      return false;
    }
    const extended = extendPlainParagraph(active, this.#file, edit.text);
    if (extended === undefined) {
      return false;
    }
    const range = extended.range;
    if (range.end - range.start > this.#maximumPendingBlockLength) {
      this.#current = this.limitSnapshot("maximumPendingBlockLength", range.end);
      return true;
    }
    const blocks = [...this.#blocks];
    blocks[blocks.length - 1] = extended;
    this.#blocks = blocks;
    const snapshots = Object.freeze(this.#blocks.map(streamingBlock));
    this.#current = Object.freeze({
      file: this.#file,
      document: new StreamingDocument([
        ...snapshots.flatMap((block) => block.document.children),
        ...this.#streamingSupplement.children,
      ]),
      blocks: snapshots,
      diagnostics: this.#current.diagnostics,
      status: "valid",
    });
    return true;
  }

  private parseStreaming(change?: Readonly<{ edit: MdxEdit; append: boolean }>): MdxStreamSnapshot {
    if (this.#file.text.length > this.#limits.maximumSourceLength) {
      return this.limitSnapshot("maximumSourceLength", this.#file.text.length);
    }
    const draft = this.#session.finalDraft();
    const parsed = materializeStrictDocument(
      draft.file,
      draft.blocks,
      this.#session.syntax,
      this.#session.limits,
    );
    if (parsed.kind === "parsed") {
      let blocks = this.materializeBlocks(parsed.document, parsed.blocks, change);
      if (draft.pending !== undefined) {
        blocks = applyPendingBlock(blocks, draft.pending, this.#file, this.#session.syntax);
      }
      blocks = applyAmbiguousMarkerBlock(blocks, this.#file);
      this.#pendingLineage = undefined;
      const active = blocks.at(-1);
      if (
        draft.pending !== undefined &&
        active !== undefined &&
        active.range.end - active.range.start > this.#maximumPendingBlockLength
      ) {
        return this.limitSnapshot("maximumPendingBlockLength", active.range.end);
      }
      this.#blocks = blocks;
      const blockSnapshots = blocks.map(streamingBlock);
      return Object.freeze({
        file: this.#file,
        document: new StreamingDocument([
          ...blockSnapshots.flatMap((block) => block.document.children),
          ...this.#streamingSupplement.children,
        ]),
        blocks: Object.freeze(blockSnapshots),
        diagnostics: parsed.diagnostics,
        status: "valid",
      });
    }
    if (parsed.kind === "limitExceeded") {
      return this.limitSnapshot(parsed.limit, this.#file.text.length);
    }
    const incomplete = draft.blocks.filter(
      (block): block is Extract<BlockSyntax, { kind: "invalidMdx" }> =>
        block.kind === "invalidMdx" && block.state === "incomplete",
    );
    if (
      incomplete.length > 0 &&
      incomplete.length === draft.blocks.filter((block) => block.kind === "invalidMdx").length
    ) {
      return this.pendingDraftSnapshot(draft.blocks, incomplete, change);
    }
    return Object.freeze({
      file: this.#file,
      document: this.#current?.document ?? new StreamingDocument([]),
      blocks: this.#current?.blocks ?? Object.freeze([]),
      diagnostics: parsed.diagnostics,
      status: "invalid",
    });
  }

  private materializeBlocks(
    document: DocumentNode,
    materializedBlocks: readonly MaterializedBlock[],
    change?: Readonly<{ edit: MdxEdit; append: boolean }>,
  ): readonly OwnedBlock[] {
    const old = this.#blocks;
    const nextDefinitions = definitionSignatures(document);
    const nextFootnotes = footnoteSignatures(document);
    const changedDefinitions = changedIdentifiers(this.#definitionSignatures, nextDefinitions);
    const changedFootnotes = changedIdentifiers(this.#footnoteSignatures, nextFootnotes);
    this.#definitionSignatures = nextDefinitions;
    this.#footnoteSignatures = nextFootnotes;
    const streaming = streamingDocuments(document, materializedBlocks, this.#file.text);
    this.#streamingSupplement = streaming.supplement;
    const delta =
      change === undefined ? 0 : change.edit.text.length - (change.edit.end - change.edit.start);
    const retainedByRange = new Map<string, OwnedBlock>();
    for (const block of old) {
      if (change === undefined) {
        retainedByRange.set(rangeKey(block.range.start, block.range.end), block);
        continue;
      }
      const insertionInside =
        change.edit.start === change.edit.end &&
        change.edit.start > block.range.start &&
        change.edit.start < block.range.end;
      if (insertionInside || rangesIntersect(block.range, change.edit)) {
        continue;
      }
      const translated =
        block.range.start >= change.edit.end
          ? { start: block.range.start + delta, end: block.range.end + delta }
          : block.range.end <= change.edit.start
            ? block.range
            : undefined;
      if (translated !== undefined) {
        retainedByRange.set(rangeKey(translated.start, translated.end), block);
      }
    }
    const candidatesByNode = new Map(
      materializedBlocks.map((block) => [block.node, block.candidates] as const),
    );
    const next: OwnedBlock[] = [];
    for (const node of document.children) {
      const origin = node.origin;
      const start = this.#file.lineAt(origin?.start ?? 0).range.start;
      const end = origin?.end ?? start;
      const range = Object.freeze({ start, end });
      const activeAppend =
        change?.append === true &&
        old.at(-1)?.range.start === start &&
        old.at(-1)?.range.end === change.edit.start &&
        end >= change.edit.start
          ? old.at(-1)
          : undefined;
      const retained = activeAppend ?? retainedByRange.get(rangeKey(start, end));
      const id =
        retained?.id ??
        (this.#pendingLineage?.start === start ? this.#pendingLineage.id : this.newBlockId());
      const candidates = candidatesByNode.get(node) ?? Object.freeze([]);
      const dependencies = dependenciesFor(node, candidates);
      const dependencyChanged =
        dependencies.definitions.some((identifier) => changedDefinitions.has(identifier)) ||
        dependencies.footnotes.some((identifier) => changedFootnotes.has(identifier));
      next.push({
        id,
        range,
        node,
        dependencies,
        candidates,
        streaming:
          retained !== undefined && delta === 0 && !dependencyChanged
            ? retained.streaming
            : (streaming.blocks.get(node) ??
              streamingDocument(strictBlockDocument(node, document), this.#file.text, candidates)),
      });
    }
    return next;
  }

  private limitCompletion(limit: ParserLimit, offset: number): MdxStreamCompletion {
    const diagnostic = createDiagnostic({
      code: "mdx-limit-exceeded",
      severity: "error",
      message: `${limit} was exceeded at source offset ${offset}`,
      span: { file: this.#file, start: offset, end: offset },
    });
    const diagnostics: readonly [Diagnostic] = Object.freeze([diagnostic]);
    return Object.freeze({
      kind: "limitExceeded",
      file: this.#file,
      limit,
      diagnostics,
    });
  }

  private limitSnapshot(limit: ParserLimit, offset: number): MdxStreamSnapshot {
    const diagnostic = createDiagnostic({
      code: "mdx-limit-exceeded",
      severity: "error",
      message: `${limit} was exceeded at source offset ${offset}`,
      span: { file: this.#file, start: offset, end: offset },
    });
    return Object.freeze({
      file: this.#file,
      document: this.#current?.document ?? new StreamingDocument([]),
      blocks: this.#current?.blocks ?? Object.freeze([]),
      diagnostics: [diagnostic],
      status: "limitExceeded",
    });
  }

  private newBlockId(): BlockId {
    const value = `block-${this.#nextId++}`;
    if (!isBlockId(value)) {
      throw new Error("Internal block identity invariant failed");
    }
    return value;
  }

  private pendingDraftSnapshot(
    drafts: readonly BlockSyntax[],
    incomplete: readonly Extract<BlockSyntax, { kind: "invalidMdx" }>[],
    change: Readonly<{ edit: MdxEdit; append: boolean }> | undefined,
  ): MdxStreamSnapshot {
    const settledDrafts = drafts.filter((block) => block.kind !== "invalidMdx");
    const settled = materializeStrictDocument(
      this.#file,
      settledDrafts,
      this.#session.syntax,
      this.#session.limits,
    );
    const owned =
      settled.kind === "parsed"
        ? this.materializeBlocks(settled.document, settled.blocks, change)
        : [];
    this.#blocks = owned;
    const pending = incomplete.map((block) => {
      if (block.range.end - block.range.start > this.#maximumPendingBlockLength) {
        return;
      }
      const id =
        this.#pendingLineage?.start === block.range.start
          ? this.#pendingLineage.id
          : this.newBlockId();
      this.#pendingLineage = { id, start: block.range.start };
      const document = pendingStreamingDocument(
        block,
        this.#file,
        this.#session.syntax,
        this.#session.limits,
      );
      return Object.freeze({
        id,
        range: block.range,
        document,
        dependencies: emptyDependencies,
      });
    });
    if (pending.some((block) => block === undefined)) {
      return this.limitSnapshot("maximumPendingBlockLength", this.#file.text.length);
    }
    const pendingBlocks = pending.filter((block) => block !== undefined);
    const blocks = Object.freeze([...owned.map(streamingBlock), ...pendingBlocks]);
    return Object.freeze({
      file: this.#file,
      document: new StreamingDocument([
        ...blocks.flatMap((block) => block.document.children),
        ...this.#streamingSupplement.children,
      ]),
      blocks,
      diagnostics: Object.freeze([]),
      status: "valid",
    });
  }

  private assertOpen(): void {
    if (this.#completion !== undefined) {
      throw new Error("A completed MdxStream is terminal");
    }
  }
}

function rangeKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function extendPlainParagraph(
  block: OwnedBlock,
  file: SourceFile,
  text: string,
): OwnedBlock | undefined {
  const paragraph = block.streaming.children.length === 1 ? block.streaming.children[0] : undefined;
  const strictChild = block.node.kind === "paragraph" ? block.node.children[0] : undefined;
  if (
    paragraph?.kind !== "element" ||
    paragraph.tagName !== "p" ||
    paragraph.children.length !== 1 ||
    paragraph.children[0].kind !== "text" ||
    block.node.children.length !== 1 ||
    strictChild?.kind !== "text"
  ) {
    return;
  }
  const child = paragraph.children[0];
  const end = file.text.length;
  const nodeOrigin = block.node.origin;
  const childOrigin = strictChild.origin;
  const node = new ParagraphNode(
    [
      new TextNode(
        strictChild.value + text,
        childOrigin === undefined ? undefined : { file, start: childOrigin.start, end },
      ),
    ],
    nodeOrigin === undefined ? undefined : { file, start: nodeOrigin.start, end },
  );
  return {
    ...block,
    range: Object.freeze({ start: block.range.start, end }),
    node,
    streaming: new StreamingDocument([
      Object.freeze({
        ...paragraph,
        range:
          paragraph.range === undefined
            ? undefined
            : Object.freeze({ start: paragraph.range.start, end }),
        children: Object.freeze([
          Object.freeze({
            ...child,
            value: child.value + text,
            range:
              child.range === undefined
                ? undefined
                : Object.freeze({ start: child.range.start, end }),
          }),
        ]),
      }),
    ]),
  };
}

function streamingBlock(block: OwnedBlock): StreamingBlockSnapshot {
  return Object.freeze({
    id: block.id,
    range: block.range,
    dependencies: block.dependencies,
    document: block.streaming,
  });
}

function definitionSignatures(document: DocumentNode): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const node of document.children) {
    if (node.kind === "definition" && !result.has(node.identifier)) {
      result.set(node.identifier, dependencyWinnerSignature(node));
    }
  }
  return result;
}

function footnoteSignatures(document: DocumentNode): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const node of document.children) {
    if (node.kind === "footnoteDefinition" && !result.has(node.identifier)) {
      result.set(node.identifier, dependencyWinnerSignature(node));
    }
  }
  return result;
}

function dependencyWinnerSignature(node: MdxNode): string {
  return JSON.stringify(node, omitSourceOrigin);
}

function omitSourceOrigin(key: string, value: unknown): unknown {
  return key === "origin" ? undefined : value;
}

function changedIdentifiers(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const changed = new Set<string>();
  for (const identifier of new Set([...previous.keys(), ...next.keys()])) {
    if (previous.get(identifier) !== next.get(identifier)) {
      changed.add(identifier);
    }
  }
  return changed;
}

function isBlockId(value: string): value is BlockId {
  return /^block-\d+$/u.test(value);
}
