import type { Diagnostic } from "./diagnostics.ts";
import type { FootnoteOccurrence } from "./footnote-numbering.ts";
import type { LoweringScope } from "./html-lower.ts";
import type { HtmlFootnoteSectionNode, HtmlNode } from "./html.ts";
import type {
  DefinitionNode,
  DocumentNode,
  FlowContent,
  FootnoteDefinitionNode,
  FootnoteReferenceNode,
  ListItemNode,
  ListNode,
  MdxNode,
  SourceRange,
  TextNode,
} from "./model.ts";
import type { BlockSyntax, PendingBlockSyntax } from "./parser/block-syntax.ts";
import type { ParserLimit, ResolvedParserLimits } from "./parser/config.ts";
import type { PhrasingCache } from "./parser/materialize.ts";
import type { SourceText } from "./source-text.ts";
import type {
  BlockId,
  CompletedBlock,
  MdxEdit,
  MdxStreamChange,
  MdxStreamCompletion,
  MdxStreamSnapshot,
  StreamBlock,
  StreamDependencies,
} from "./stream-types.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

import { createDiagnostic } from "./diagnostics.ts";
import { LimitError, ParseError } from "./errors.ts";
import { FootnoteNumbering } from "./footnote-numbering.ts";
import { createHtmlLoweringCache, lowerFootnoteSection, lowerNodes } from "./html-lower.ts";
import { mdxChildren } from "./model.ts";
import { createMaterializeCache } from "./parser/materialize-cache.ts";
import { materializeDocument } from "./parser/materialize.ts";
import { ParserSession } from "./parser/session.ts";
import { rangesIntersect, shiftRange } from "./ranges.ts";
import { SourceBuffer, sourceText, type SourceFile } from "./source.ts";
import { FenceText, lowerOpenLeaf, OpenParagraph, trimOpenTail } from "./stream-tail.ts";
import { rewriteMdx } from "./traversal.ts";

export interface StreamSessionOptions {
  readonly name: string;
  readonly source: string;
  readonly syntax: SyntaxOptions | undefined;
  readonly limits: ResolvedParserLimits;
  readonly maximumPendingBlockLength: number;
}

/** Parser output for one top-level block, materialized once. */
type Materialized =
  | Readonly<{
      kind: "ok";
      node: FlowContent;
      nodeCount: number;
      diagnostics: readonly Diagnostic[];
      contents: BlockContents;
    }>
  | Readonly<{ kind: "invalid"; diagnostics: readonly Diagnostic[] }>
  | Readonly<{ kind: "limitExceeded"; limit: ParserLimit }>;

/** References a block makes and definitions it contains, in document order. */
interface BlockContents {
  readonly definitionReferences: readonly string[];
  readonly footnoteReferences: readonly FootnoteReferenceNode[];
  readonly definitions: readonly DefinitionNode[];
  readonly footnotes: readonly FootnoteDefinitionNode[];
}

type Occurrences = readonly (FootnoteOccurrence | undefined)[];

interface BlockEntry {
  readonly syntax: BlockSyntax;
  readonly id: BlockId;
  readonly origin: SourceRange;
  readonly materialized: Materialized;
  /** The open leaf the block rendered, which later input may extend. */
  readonly pending: PendingBlockSyntax | undefined;
  /** Nodes the open leaf materialized while rendering, for the node limit. */
  readonly pendingNodes: number;
  /** The numbering the block rendered with, aligned with its footnote references. */
  readonly occurrences: Occurrences;
  /** `undefined` until the block renders. */
  readonly block: StreamBlock | undefined;
}

type RenderedEntry = BlockEntry & { readonly block: StreamBlock };

/** Definitions by identifier, first per identifier in document order. */
interface Definitions {
  readonly links: ReadonlyMap<string, DefinitionNode>;
  readonly footnotes: ReadonlyMap<string, FootnoteDefinitionNode>;
}

interface Settlement {
  readonly syntax: BlockSyntax;
  readonly index: number;
}

interface LimitState {
  readonly limit: ParserLimit;
  readonly offset: number;
}

const emptyDefinitions: Definitions = { links: new Map(), footnotes: new Map() };

const noOccurrences: Occurrences = Object.freeze([]);

const noDependencies: StreamDependencies = Object.freeze({
  definitions: Object.freeze([]),
  footnotes: Object.freeze([]),
});

/**
 * Owns the parser and the rendered blocks of one stream. A top-level block
 * settles once later input cannot change it, and then materializes and lowers
 * once. Each append renders only the open tail; a settled block renders again
 * only when a definition or footnote number it uses changes.
 */
export class StreamSession {
  readonly #limits: ResolvedParserLimits;
  readonly #maximumPendingBlockLength: number;
  readonly #parser: ParserSession;
  /** The stream owns its source; each version is an immutable file. */
  readonly #source: SourceBuffer;
  #file: SourceFile;

  /** Settled parser output that has not been rendered yet. */
  #queue: Settlement[] = [];
  #settled: BlockEntry[] = [];
  /** The settled blocks' renderings, kept beside the entries so a snapshot copies one array. */
  #blocks: StreamBlock[] = [];
  #tail: RenderedEntry[] = [];

  // Running totals over the settled blocks.
  #definitions: Definitions = emptyDefinitions;
  #dependents = new Map<string, Set<number>>();
  #nodes = 0;
  #diagnostics: Diagnostic[] = [];
  #limited: LimitState | undefined;
  #numbering = new FootnoteNumbering();
  #occurrences = new WeakMap<FootnoteReferenceNode, FootnoteOccurrence>();

  // The open tail, rebuilt on every change.
  #tailDefinitions: Definitions = emptyDefinitions;
  #tailNumbering = new FootnoteNumbering();
  #tailOccurrences = new WeakMap<FootnoteReferenceNode, FootnoteOccurrence>();

  #definitionsVersion = 0;
  #footnotes: HtmlFootnoteSectionNode | undefined;
  #footnotesKey: readonly unknown[] = [];
  readonly #materializeCache = createMaterializeCache();
  #loweringCache = createHtmlLoweringCache();
  readonly #fence = new FenceText();
  readonly #paragraph = new OpenParagraph();
  readonly #phrasing: PhrasingCache = new WeakMap();
  #nextId = 0;
  #current: MdxStreamChange;
  #lastValid: MdxStreamSnapshot | undefined;
  /** The settled numbering must restart, because settled blocks were dropped. */
  #renumber = false;
  #limitedPreview = false;

  public constructor(options: StreamSessionOptions) {
    this.#limits = options.limits;
    this.#maximumPendingBlockLength = options.maximumPendingBlockLength;
    this.#source = new SourceBuffer({ name: options.name, text: options.source });
    this.#file = this.#source.file;

    this.#parser = new ParserSession({
      source: this.#file,
      syntax: options.syntax,
      onSettled: (syntax, index) => this.#queue.push({ syntax, index }),
    });

    this.#current = this.update(0);
  }

  /** The latest change, whose snapshot is the current preview. */
  public get current(): MdxStreamChange {
    return this.#current;
  }

  public append(text: string): MdxStreamChange {
    const start = this.#settled.length;
    this.#file = this.#source.append(text);
    // The parser shares the file text, so the growing string is flattened only once.
    this.#parser.append(text, sourceText(this.#file));
    this.#current = this.update(start);

    return this.#current;
  }

  public edit(edit: MdxEdit): MdxStreamChange {
    const retired = this.retiredIds(edit);
    this.#file = this.#source.replace(edit.start, edit.end, edit.text);
    this.#parser.edit(edit);
    this.#current = this.update(this.#settled.length, retired);

    return this.#current;
  }

  /**
   * Finishes the tail strictly and assembles the document from the settled
   * blocks' nodes, so only the tail materializes again.
   */
  public complete(): MdxStreamCompletion {
    const limited = this.limitState();

    if (limited !== undefined && limited.limit !== "maximumPendingBlockLength") {
      throw this.limitError(limited);
    }

    // The tail draft finishes a copy, so a failed completion leaves the stream open.
    const tail = this.#parser.tailDraft().blocks;
    const settled = this.#settled;

    const diagnostics: Diagnostic[] = [];
    const errors: Diagnostic[] = [];
    const parts: CompletedPart[] = [];
    let nodes = 1 + this.#nodes;

    for (const entry of settled) {
      if (entry.materialized.kind === "invalid") {
        errors.push(...entry.materialized.diagnostics);
      } else if (entry.materialized.kind === "ok") {
        diagnostics.push(...entry.materialized.diagnostics);
        parts.push({ id: entry.id, origin: entry.origin, node: entry.materialized.node });
      }
    }

    const tailIds = new Map(this.#tail.map((entry) => [entry.origin.start, entry.id]));

    for (const syntax of tail) {
      const origin = blockOrigin(sourceText(this.#file), syntax);

      const materialized = materializeDocument(
        this.#file,
        [syntax],
        this.#parser.syntax,
        { ...this.#limits, maximumNodes: Math.max(1, this.#limits.maximumNodes - nodes + 1) },
        { keepReferences: true, cache: this.#materializeCache },
      );

      if (materialized.kind === "limitExceeded") {
        throw this.limitError({ limit: materialized.limit, offset: origin.end });
      }

      if (materialized.kind === "invalid") {
        errors.push(...materialized.diagnostics);
        continue;
      }

      diagnostics.push(...materialized.diagnostics);

      for (const block of materialized.blocks) {
        nodes += block.nodeCount;
        parts.push({ id: tailIds.get(origin.start) ?? this.newId(), origin, node: block.node });
      }
    }

    const [firstError, ...otherErrors] = errors;

    if (firstError !== undefined) {
      throw ParseError.invalidSyntax(this.#file, [firstError, ...otherErrors]);
    }

    if (nodes > this.#limits.maximumNodes) {
      throw this.limitError({ limit: "maximumNodes", offset: this.#file.length });
    }

    const definitions = collectDefinitions(parts.map((part) => part.node));

    const document: DocumentNode = {
      kind: "document",
      children: parts.map((part) => resolveReferences(part.node, definitions, this.#file)),
      origin: { start: 0, end: this.#file.length },
    };

    return Object.freeze({
      kind: "complete",
      file: this.#file,
      document,
      blocks: Object.freeze(
        parts.map((part): CompletedBlock => Object.freeze({ id: part.id, origin: part.origin })),
      ),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  /**
   * Settles queued blocks, renders the blocks whose definitions or footnote
   * numbers changed, renders the open tail, and assembles the snapshot.
   */
  private update(previousSettled: number, retired?: ReadonlyMap<string, BlockId>): MdxStreamChange {
    if (this.#file.length > this.#limits.maximumSourceLength) {
      return this.limitChange({ limit: "maximumSourceLength", offset: this.#file.length });
    }

    const before = this.effectiveDefinitions();
    const previousTail = this.#tail;
    const start = Math.min(previousSettled, this.dropChangedSettled());
    const firstAdded = this.#settled.length;
    const adopted = this.settleQueued(previousTail, retired);

    const draft = this.#parser.tailDraft();
    const parts = draft.blocks.map((syntax) => this.materializeTail(syntax, draft.pending));
    this.#tailDefinitions = collectDefinitions(parts.flatMap(materializedNodes));
    const after = this.effectiveDefinitions();
    const changed = changedDefinitions(before, after);
    const refreshed = this.refreshSettled(changed, after, firstAdded, adopted, start);
    this.renderTail(parts, previousTail, retired, after, changed.links);

    const footnotes = this.footnoteSection(after);
    const limited = this.limitState(draft.pending);

    if (limited !== undefined) {
      return this.limitChange(limited);
    }

    const snapshot: MdxStreamSnapshot = Object.freeze({
      kind: "preview",
      file: this.#file,
      blocks: Object.freeze([...this.#blocks, ...this.#tail.map((entry) => entry.block)]),
      footnotes,
      diagnostics: Object.freeze([
        ...this.#diagnostics,
        ...this.#tail.flatMap((entry) => entry.block.diagnostics),
      ]),
      limit: undefined,
    });

    // After a limited preview, consumers hold the last valid blocks, which can be older.
    const continuous = !this.#limitedPreview;
    this.#limitedPreview = false;
    const previous = this.#lastValid;
    this.#lastValid = snapshot;

    return Object.freeze({
      snapshot,
      start: previous !== undefined && continuous ? start : 0,
      refreshed: Object.freeze(continuous ? refreshed : []),
      footnotesChanged: footnotes !== previous?.footnotes,
    });
  }

  /**
   * Drops settled blocks that an edit replaced, which settle again from the
   * queue, and returns how many settled blocks remain.
   */
  private dropChangedSettled(): number {
    const keep = Math.min(
      this.#settled.length,
      this.#parser.settledCount,
      this.#queue[0]?.index ?? Infinity,
    );

    if (keep < this.#settled.length) {
      this.truncate(keep);
    }

    return this.#settled.length;
  }

  /** Settles queued parser output and returns the indexes of blocks adopted from the tail. */
  private settleQueued(
    previousTail: readonly RenderedEntry[],
    retired: ReadonlyMap<string, BlockId> | undefined,
  ): ReadonlySet<number> {
    const adopted = new Set<number>();

    for (const settlement of this.#queue) {
      if (settlement.index !== this.#settled.length) {
        continue;
      }

      const entry = this.settle(settlement.syntax, previousTail, retired);

      if (entry.block !== undefined) {
        adopted.add(this.#settled.length);
      }

      this.addSettled(entry);
    }

    this.#queue = [];

    return adopted;
  }

  /**
   * Renders newly settled blocks, and settled blocks whose definitions or
   * footnote numbers changed. Returns the re-rendered blocks before `start`.
   */
  private refreshSettled(
    changed: DefinitionChanges,
    definitions: Definitions,
    firstAdded: number,
    adopted: ReadonlySet<number>,
    start: number,
  ): StreamBlock[] {
    const dirty = new Set<number>();

    if (changed.links.size > 0) {
      // Cached subtrees may contain references to the changed definitions.
      this.#loweringCache = createHtmlLoweringCache();
      this.#definitionsVersion++;

      for (const identifier of changed.links) {
        for (const index of this.#dependents.get(identifier) ?? []) {
          dirty.add(index);
        }
      }
    }

    const renumberAll = changed.footnotes || this.#renumber;
    this.#renumber = false;

    for (const index of this.renumber(renumberAll ? 0 : firstAdded)) {
      dirty.add(index);
    }

    for (let index = firstAdded; index < this.#settled.length; index++) {
      if (!adopted.has(index)) {
        dirty.add(index);
      }
    }

    const refreshed: StreamBlock[] = [];

    for (const index of dirty) {
      this.#settled[index] = this.render(
        this.#settled[index],
        definitions,
        this.#occurrences,
        true,
      );
      this.#blocks[index] = renderedBlock(this.#settled[index]);

      if (index < start) {
        refreshed.push(renderedBlock(this.#settled[index]));
      }
    }

    // An adopted tail block keeps its rendering and only becomes settled.
    for (const index of adopted) {
      const entry = this.#settled[index];
      const block = renderedBlock(entry);

      if (!dirty.has(index) && !block.settled) {
        this.#settled[index] = { ...entry, block: Object.freeze({ ...block, settled: true }) };
        this.#blocks[index] = renderedBlock(this.#settled[index]);
      }
    }

    return refreshed;
  }

  /** Adopts the tail's rendering for a block that settled unchanged, or queues it to render. */
  private settle(
    syntax: BlockSyntax,
    previousTail: readonly RenderedEntry[],
    retired: ReadonlyMap<string, BlockId> | undefined,
  ): BlockEntry {
    const adopted = previousTail.find(
      (entry) => entry.syntax === syntax && entry.pending === undefined,
    );

    if (adopted !== undefined) {
      return adopted;
    }

    const origin = blockOrigin(sourceText(this.#file), syntax);

    return {
      syntax,
      id: this.blockId(origin, previousTail, retired),
      origin,
      materialized: this.materialize(syntax, this.#limits.maximumNodes - 1 - this.#nodes),
      pending: undefined,
      pendingNodes: 0,
      occurrences: noOccurrences,
      block: undefined,
    };
  }

  private materializeTail(syntax: BlockSyntax, pending: PendingBlockSyntax | undefined): TailPart {
    const open =
      pending !== undefined && containsRange(syntax.range, pending.range) ? pending : undefined;

    return {
      syntax,
      origin: blockOrigin(sourceText(this.#file), syntax),
      materialized: this.materialize(
        syntax,
        this.#limits.maximumNodes - 1 - this.#nodes,
        open?.range,
      ),
      pending: open,
    };
  }

  private materialize(syntax: BlockSyntax, budget: number, open?: SourceRange): Materialized {
    if (budget < 1) {
      return { kind: "limitExceeded", limit: "maximumNodes" };
    }

    const result = materializeDocument(
      this.#file,
      [syntax],
      this.#parser.syntax,
      // The stream counts the document node once.
      { ...this.#limits, maximumNodes: budget + 1 },
      { keepReferences: true, allowIncomplete: true, cache: this.#materializeCache, open },
    );

    if (result.kind === "limitExceeded") {
      return { kind: "limitExceeded", limit: result.limit };
    }

    if (result.kind === "invalid") {
      return { kind: "invalid", diagnostics: result.diagnostics };
    }

    const [block] = result.blocks;

    if (block === undefined) {
      throw new Error("A stream block materialized to no node");
    }

    return {
      kind: "ok",
      node: block.node,
      nodeCount: block.nodeCount,
      diagnostics: result.diagnostics,
      contents: blockContents(block.node),
    };
  }

  /** Adds one settled block to the running totals. Its rendering may still be pending. */
  private addSettled(entry: BlockEntry): void {
    const index = this.#settled.length;
    this.#settled.push(entry);
    // An entry without a rendering renders before the update publishes a snapshot.
    this.#blocks.push(entry.block ?? unrendered);
    const { materialized } = entry;

    if (materialized.kind === "limitExceeded") {
      this.#limited ??= { limit: materialized.limit, offset: entry.origin.end };

      return;
    }

    this.#diagnostics.push(...materialized.diagnostics);

    if (materialized.kind === "invalid") {
      return;
    }

    const { contents } = materialized;
    this.#nodes += materialized.nodeCount;

    if (contents.definitions.length > 0 || contents.footnotes.length > 0) {
      const links = new Map(this.#definitions.links);
      const footnotes = new Map(this.#definitions.footnotes);
      addFirst(links, contents.definitions);
      addFirst(footnotes, contents.footnotes);
      this.#definitions = { links, footnotes };
    }

    for (const identifier of contents.definitionReferences) {
      let dependents = this.#dependents.get(identifier);

      if (dependents === undefined) {
        dependents = new Set();
        this.#dependents.set(identifier, dependents);
      }

      dependents.add(index);
    }
  }

  /** Drops the settled blocks from `length` on, after an edit before them. */
  private truncate(length: number): void {
    const kept = this.#settled.slice(0, length);
    this.#settled = [];
    this.#blocks = [];
    this.#definitions = emptyDefinitions;
    this.#dependents = new Map();
    this.#nodes = 0;
    this.#diagnostics = [];
    this.#limited = undefined;

    for (const entry of kept) {
      this.addSettled(entry);
    }

    this.#renumber = true;
  }

  /**
   * Numbers footnote references in settled blocks from `from` on, continuing
   * the numbering before them, and returns the blocks whose numbers changed.
   */
  private renumber(from: number): number[] {
    if (from === 0) {
      this.#numbering = new FootnoteNumbering();
      this.#occurrences = new WeakMap();
    }

    const changed: number[] = [];

    for (let index = from; index < this.#settled.length; index++) {
      const entry = this.#settled[index];

      const occurrences = numberReferences(
        entry.materialized,
        this.#numbering,
        this.#occurrences,
        (identifier) => this.isFootnoteDefined(identifier),
      );

      if (!sameOccurrences(entry.occurrences, occurrences)) {
        changed.push(index);
        this.#settled[index] = { ...entry, occurrences };
      }
    }

    return changed;
  }

  private renderTail(
    parts: readonly TailPart[],
    previousTail: readonly RenderedEntry[],
    retired: ReadonlyMap<string, BlockId> | undefined,
    definitions: Definitions,
    changedLinks: ReadonlySet<string>,
  ): void {
    this.#tailNumbering = this.#numbering.fork();
    this.#tailOccurrences = new WeakMap();

    this.#tail = parts.map((part) => {
      const occurrences = numberReferences(
        part.materialized,
        this.#tailNumbering,
        this.#tailOccurrences,
        (identifier) => this.isFootnoteDefined(identifier),
      );

      const reusable = previousTail.find(
        (entry) =>
          entry.syntax === part.syntax &&
          entry.pending === undefined &&
          part.pending === undefined &&
          sameOccurrences(entry.occurrences, occurrences) &&
          !dependsOn(entry, changedLinks),
      );

      if (reusable !== undefined) {
        return reusable;
      }

      return this.render(
        {
          ...part,
          id: this.blockId(part.origin, previousTail, retired),
          pendingNodes: 0,
          occurrences,
          block: undefined,
        },
        definitions,
        this.#tailOccurrences,
        false,
      );
    });

    // The last block ends where input stopped, so a bare marker there can still become other syntax.
    const last = this.#tail.at(-1);

    if (last !== undefined) {
      const nodes = trimOpenTail(last.block.nodes);

      if (nodes !== last.block.nodes) {
        this.#tail[this.#tail.length - 1] = {
          ...last,
          block: Object.freeze({ ...last.block, nodes: Object.freeze(nodes) }),
        };
      }
    }
  }

  /** Lowers one block in the stream's scope. */
  private render(
    entry: BlockEntry,
    definitions: Definitions,
    occurrences: WeakMap<FootnoteReferenceNode, FootnoteOccurrence>,
    settled: boolean,
  ): RenderedEntry {
    const { materialized, pending } = entry;

    if (materialized.kind !== "ok") {
      const invalid = materialized.kind === "invalid";

      return {
        ...entry,
        block: Object.freeze({
          id: entry.id,
          origin: entry.origin,
          nodes: Object.freeze(invalid ? inertSource(this.#file, entry.origin) : []),
          status: invalid ? "invalid" : "valid",
          settled,
          diagnostics: invalid ? materialized.diagnostics : Object.freeze([]),
          dependencies: noDependencies,
        }),
      };
    }

    let pendingNodes = 0;

    const scope: LoweringScope = {
      definition: (identifier) => definitions.links.get(identifier),
      footnote: (identifier) => definitions.footnotes.get(identifier),
      occurrence: (node) => occurrences.get(node),
      options: { source: this.#file },
      provisional: true,
      cache: this.#loweringCache,
    };

    const nodes = lowerNodes(
      [materialized.node],
      pending === undefined
        ? scope
        : {
            ...scope,
            replace: (node) => {
              const open = lowerOpenLeaf(
                node,
                pending,
                {
                  file: this.#file,
                  syntax: this.#parser.syntax,
                  limits: this.#limits,
                  fence: this.#fence,
                  paragraph: this.#paragraph,
                  phrasing: this.#phrasing,
                  lowering: this.#loweringCache,
                },
                (children, previous) => lowerNodes(children, scope, previous),
              );

              pendingNodes += open?.nodeCount ?? 0;

              return open?.nodes;
            },
          },
    );

    return {
      ...entry,
      pendingNodes,
      block: Object.freeze({
        id: entry.id,
        origin: entry.origin,
        nodes: Object.freeze(nodes),
        status: "valid",
        settled,
        diagnostics: materialized.diagnostics,
        dependencies: dependenciesOf(materialized.contents),
      }),
    };
  }

  private isFootnoteDefined(identifier: string): boolean {
    return (
      this.#definitions.footnotes.has(identifier) || this.#tailDefinitions.footnotes.has(identifier)
    );
  }

  private effectiveDefinitions(): Definitions {
    const tail = this.#tailDefinitions;

    if (tail.links.size === 0 && tail.footnotes.size === 0) {
      return this.#definitions;
    }

    const links = new Map(this.#definitions.links);
    const footnotes = new Map(this.#definitions.footnotes);
    addFirst(links, [...tail.links.values()]);
    addFirst(footnotes, [...tail.footnotes.values()]);

    return { links, footnotes };
  }

  /** The footnote section, rebuilt only when its numbering or definitions change. */
  private footnoteSection(definitions: Definitions): HtmlFootnoteSectionNode | undefined {
    const numbering = this.#tailNumbering;

    const key = [
      this.#definitionsVersion,
      ...numbering.order.flatMap((identifier) => [
        identifier,
        numbering.count(identifier),
        definitions.footnotes.get(identifier),
      ]),
    ];

    if (
      key.length === this.#footnotesKey.length &&
      key.every((value, index) => value === this.#footnotesKey[index])
    ) {
      return this.#footnotes;
    }

    this.#footnotesKey = key;
    this.#footnotes = lowerFootnoteSection(numbering, {
      definition: (identifier) => definitions.links.get(identifier),
      footnote: (identifier) => definitions.footnotes.get(identifier),
      occurrence: (node) => this.#occurrences.get(node) ?? this.#tailOccurrences.get(node),
      options: { source: this.#file },
      provisional: true,
    });

    return this.#footnotes;
  }

  /** The first limit the stream exceeds, if any. */
  private limitState(pending?: PendingBlockSyntax): LimitState | undefined {
    if (this.#file.length > this.#limits.maximumSourceLength) {
      return { limit: "maximumSourceLength", offset: this.#file.length };
    }

    if (this.#limited !== undefined) {
      return this.#limited;
    }

    let nodes = 1 + this.#nodes;

    for (const entry of this.#tail) {
      if (entry.materialized.kind === "limitExceeded") {
        return { limit: entry.materialized.limit, offset: entry.origin.end };
      }

      nodes +=
        (entry.materialized.kind === "ok" ? entry.materialized.nodeCount : 0) + entry.pendingNodes;
    }

    if (nodes > this.#limits.maximumNodes) {
      return { limit: "maximumNodes", offset: this.#tail.at(-1)?.origin.end ?? 0 };
    }

    const owner =
      pending === undefined ? undefined : this.#tail.find((entry) => entry.pending !== undefined);

    if (
      owner !== undefined &&
      owner.syntax.range.end - owner.syntax.range.start > this.#maximumPendingBlockLength
    ) {
      return { limit: "maximumPendingBlockLength", offset: owner.syntax.range.end };
    }

    return undefined;
  }

  /** Keeps the last preview within limits, with its block identities. */
  private limitChange(state: LimitState): MdxStreamChange {
    this.#limitedPreview = true;

    const snapshot: MdxStreamSnapshot = Object.freeze({
      kind: "preview",
      file: this.#file,
      blocks: this.#lastValid?.blocks ?? Object.freeze([]),
      footnotes: this.#lastValid?.footnotes,
      diagnostics: Object.freeze([limitDiagnostic(this.#file, state)]),
      limit: state.limit,
    });

    return Object.freeze({
      snapshot,
      start: snapshot.blocks.length,
      refreshed: Object.freeze([]),
      footnotesChanged: false,
    });
  }

  private limitError(state: LimitState): LimitError {
    const maximum =
      state.limit === "maximumPendingBlockLength"
        ? this.#maximumPendingBlockLength
        : this.#limits[state.limit];

    return LimitError.exceeded(
      this.#file,
      state.limit,
      maximum,
      { start: state.offset, end: state.offset },
      state.limit === "maximumSourceLength" ? this.#file.length : undefined,
    );
  }

  /** A block keeps its identity across appends, and across edits that do not touch it. */
  private blockId(
    origin: SourceRange,
    previousTail: readonly RenderedEntry[],
    retired: ReadonlyMap<string, BlockId> | undefined,
  ): BlockId {
    if (retired !== undefined) {
      return retired.get(rangeKey(origin)) ?? this.newId();
    }

    return previousTail.find((entry) => entry.origin.start === origin.start)?.id ?? this.newId();
  }

  /** Identities of blocks an edit does not touch, keyed by their range after the edit. */
  private retiredIds(edit: MdxEdit): ReadonlyMap<string, BlockId> {
    const retired = new Map<string, BlockId>();
    const delta = edit.text.length - (edit.end - edit.start);

    for (const entry of [...this.#settled, ...this.#tail]) {
      if (!rangesIntersect(entry.origin, edit)) {
        retired.set(
          rangeKey(entry.origin.start >= edit.end ? shiftRange(entry.origin, delta) : entry.origin),
          entry.id,
        );
      }
    }

    return retired;
  }

  private newId(): BlockId {
    const value = `block-${this.#nextId++}`;

    if (!isBlockId(value)) {
      throw new Error("Internal block identity invariant failed");
    }

    return value;
  }
}

interface CompletedPart {
  readonly id: BlockId;
  readonly origin: SourceRange;
  readonly node: FlowContent;
}

/** Link identifiers whose rendering changed, and whether the set of footnotes changed. */
interface DefinitionChanges {
  readonly links: ReadonlySet<string>;
  readonly footnotes: boolean;
}

interface TailPart {
  readonly syntax: BlockSyntax;
  readonly origin: SourceRange;
  readonly materialized: Materialized;
  readonly pending: PendingBlockSyntax | undefined;
}

/** Stands in for a settled block until it renders later in the same update. */
const unrendered: StreamBlock = Object.freeze({
  id: placeholderId(),
  origin: Object.freeze({ start: 0, end: 0 }),
  nodes: Object.freeze([]),
  status: "valid",
  settled: true,
  diagnostics: Object.freeze([]),
  dependencies: noDependencies,
});

/** Every settled entry renders before an update publishes its snapshot. */
function renderedBlock(entry: BlockEntry): StreamBlock {
  if (entry.block === undefined) {
    throw new Error("A settled stream block was not rendered");
  }

  return entry.block;
}

function materializedNodes(part: TailPart): FlowContent[] {
  return part.materialized.kind === "ok" ? [part.materialized.node] : [];
}

const emptyContents: BlockContents = Object.freeze({
  definitionReferences: Object.freeze([]),
  footnoteReferences: Object.freeze([]),
  definitions: Object.freeze([]),
  footnotes: Object.freeze([]),
});

/** Contents by node identity. Trees are immutable, so a reused subtree is walked once. */
const contentsCache = new WeakMap<MdxNode, BlockContents>();

/** The references a node makes and the definitions it contains, in document order. */
function blockContents(node: MdxNode): BlockContents {
  const hit = contentsCache.get(node);

  if (hit !== undefined) {
    return hit;
  }

  if (node.kind === "list") {
    return listContents(node);
  }

  const parts = mdxChildren(node).map(blockContents);

  switch (node.kind) {
    case "linkReference":
    case "imageReference":
      parts.unshift({ ...emptyContents, definitionReferences: [node.identifier] });
      break;
    case "footnoteReference":
      parts.unshift({ ...emptyContents, footnoteReferences: [node] });
      break;
    case "definition":
      parts.unshift({ ...emptyContents, definitions: [node] });
      break;
    case "footnoteDefinition":
      parts.unshift({ ...emptyContents, footnotes: [node] });
      break;
    default:
      break;
  }

  const filled = parts.filter((part) => part !== emptyContents);

  const contents =
    filled.length === 0
      ? emptyContents
      : filled.length === 1
        ? filled[0]
        : {
            definitionReferences: [...new Set(filled.flatMap((part) => part.definitionReferences))],
            footnoteReferences: filled.flatMap((part) => part.footnoteReferences),
            definitions: filled.flatMap((part) => part.definitions),
            footnotes: filled.flatMap((part) => part.footnotes),
          };

  contentsCache.set(node, contents);

  return contents;
}

/** A list's contents after each of its last items, by item. */
const listContentsCache = new WeakMap<
  ListItemNode,
  Readonly<{ index: number; contents: BlockContents }>
>();

/** A growing list combines the contents of its unchanged leading items once. */
function listContents(node: ListNode): BlockContents {
  const items = node.children;
  let start = 0;
  let contents = emptyContents;

  for (let index = items.length - 1; index >= Math.max(0, items.length - 8); index--) {
    const prefix = listContentsCache.get(items[index]);

    if (prefix?.index === index) {
      start = index + 1;
      contents = prefix.contents;
      break;
    }
  }

  for (let index = start; index < items.length; index++) {
    contents = mergeContents(contents, blockContents(items[index]));

    if (index >= items.length - 8) {
      listContentsCache.set(items[index], { index, contents });
    }
  }

  contentsCache.set(node, contents);

  return contents;
}

function mergeContents(left: BlockContents, right: BlockContents): BlockContents {
  if (right === emptyContents) {
    return left;
  }

  if (left === emptyContents) {
    return right;
  }

  return {
    definitionReferences: [
      ...new Set([...left.definitionReferences, ...right.definitionReferences]),
    ],
    footnoteReferences: [...left.footnoteReferences, ...right.footnoteReferences],
    definitions: [...left.definitions, ...right.definitions],
    footnotes: [...left.footnotes, ...right.footnotes],
  };
}

function collectDefinitions(nodes: readonly MdxNode[]): Definitions {
  const links = new Map<string, DefinitionNode>();
  const footnotes = new Map<string, FootnoteDefinitionNode>();

  for (const node of nodes) {
    const contents = blockContents(node);
    addFirst(links, contents.definitions);
    addFirst(footnotes, contents.footnotes);
  }

  return { links, footnotes };
}

function addFirst<TNode extends DefinitionNode | FootnoteDefinitionNode>(
  target: Map<string, TNode>,
  nodes: readonly TNode[],
): void {
  for (const node of nodes) {
    if (!target.has(node.identifier)) {
      target.set(node.identifier, node);
    }
  }
}

function changedDefinitions(before: Definitions, after: Definitions): DefinitionChanges {
  const links = new Set<string>();

  if (before.links !== after.links) {
    for (const identifier of new Set([...before.links.keys(), ...after.links.keys()])) {
      const previous = before.links.get(identifier);
      const next = after.links.get(identifier);

      if (previous?.url !== next?.url || previous?.title !== next?.title) {
        links.add(identifier);
      }
    }
  }

  let footnotes = before.footnotes.size !== after.footnotes.size;

  for (const identifier of after.footnotes.keys()) {
    footnotes ||= !before.footnotes.has(identifier);
  }

  return { links, footnotes };
}

function numberReferences(
  materialized: Materialized,
  numbering: FootnoteNumbering,
  occurrences: WeakMap<FootnoteReferenceNode, FootnoteOccurrence>,
  defined: (identifier: string) => boolean,
): Occurrences {
  if (materialized.kind !== "ok" || materialized.contents.footnoteReferences.length === 0) {
    return noOccurrences;
  }

  return materialized.contents.footnoteReferences.map((node): FootnoteOccurrence | undefined => {
    if (!defined(node.identifier)) {
      return;
    }

    const occurrence = numbering.reference(node.identifier);
    occurrences.set(node, occurrence);

    return occurrence;
  });
}

function sameOccurrences(left: Occurrences, right: Occurrences): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every(
        (occurrence, index) =>
          occurrence?.ordinal === right[index]?.ordinal &&
          occurrence?.occurrence === right[index]?.occurrence,
      ))
  );
}

function dependsOn(entry: BlockEntry, identifiers: ReadonlySet<string>): boolean {
  return (
    identifiers.size > 0 &&
    entry.materialized.kind === "ok" &&
    entry.materialized.contents.definitionReferences.some((identifier) =>
      identifiers.has(identifier),
    )
  );
}

function dependenciesOf(contents: BlockContents): StreamDependencies {
  if (contents.definitionReferences.length === 0 && contents.footnoteReferences.length === 0) {
    return noDependencies;
  }

  return Object.freeze({
    definitions: Object.freeze([...contents.definitionReferences]),
    footnotes: Object.freeze([
      ...new Set(contents.footnoteReferences.map((node) => node.identifier)),
    ]),
  });
}

/** Turns references without definitions into their authored text, like batch parsing. */
function resolveReferences(
  node: FlowContent,
  definitions: Definitions,
  file: SourceFile,
): FlowContent {
  const contents = blockContents(node);

  const unresolved =
    contents.definitionReferences.some((identifier) => !definitions.links.has(identifier)) ||
    contents.footnoteReferences.some(
      (reference) => !definitions.footnotes.has(reference.identifier),
    );

  if (!unresolved) {
    return node;
  }

  const authored = (reference: MdxNode): TextNode | undefined =>
    reference.origin === undefined
      ? undefined
      : { kind: "text", value: file.slice(reference.origin), origin: reference.origin };

  const [result] = rewriteMdx(
    { kind: "document", children: [node] },
    {
      linkReference: ({ node: reference }) =>
        definitions.links.has(reference.identifier) ? undefined : authored(reference),
      imageReference: ({ node: reference }) =>
        definitions.links.has(reference.identifier) ? undefined : authored(reference),
      footnoteReference: ({ node: reference }) =>
        definitions.footnotes.has(reference.identifier) ? undefined : authored(reference),
    },
  ).children;

  if (result === undefined) {
    throw new Error("Reference resolution removed a stream block");
  }

  return result;
}

/** Invalid authored source renders as inert text. */
function inertSource(file: SourceFile, origin: SourceRange): HtmlNode[] {
  return [
    {
      kind: "element",
      tagName: "p",
      attributes: {},
      children: [{ kind: "text", value: file.semanticSlice(origin).trimEnd(), origin }],
      origin,
    },
  ];
}

function limitDiagnostic(file: SourceFile, state: LimitState): Diagnostic {
  return createDiagnostic({
    code: "mdx-limit-exceeded",
    severity: "error",
    message: `${state.limit} was exceeded at source offset ${state.offset}`,
    span: { file, start: state.offset, end: state.offset },
  });
}

/** A block starts at the start of its first physical line. */
function blockOrigin(text: SourceText, syntax: BlockSyntax): SourceRange {
  let start = syntax.range.start;

  while (start > 0 && text.char(start - 1) !== "\n" && text.char(start - 1) !== "\r") {
    start--;
  }

  return { start, end: syntax.range.end };
}

function containsRange(outer: SourceRange, inner: SourceRange): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

function rangeKey(range: SourceRange): string {
  return `${range.start}:${range.end}`;
}

/** The placeholder never reaches a snapshot, so its identity never meets a real block. */
function placeholderId(): BlockId {
  const value = "block-0";

  if (!isBlockId(value)) {
    throw new Error("Internal block identity invariant failed");
  }

  return value;
}

function isBlockId(value: string): value is BlockId {
  return /^block-\d+$/u.test(value);
}
