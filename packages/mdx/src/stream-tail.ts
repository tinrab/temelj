import type { HtmlLoweringCache } from "./html-lower.ts";
import type { HtmlElementNode, HtmlNode, HtmlPendingNode, HtmlRootNode } from "./html.ts";
import type { JsxAttributeLike, MdxNode, PhrasingContent, SourceRange } from "./model.ts";
import type { BlockSyntax, PendingBlockSyntax } from "./parser/block-syntax.ts";
import type { ResolvedParserLimits } from "./parser/config.ts";
import type { CommittedJsxOpening } from "./parser/embedded-scanner.ts";
import type { InlinePendingSyntax, InlineSyntax } from "./parser/inline-syntax.ts";
import type { PhrasingCache } from "./parser/materialize.ts";
import type { SourceFile } from "./source.ts";
import type { ResolvedSyntaxOptions } from "./syntax-options.ts";

import { footnoteReferences } from "./html-lower.ts";
import { parseFlowRange } from "./parser/block-parser.ts";
import { InlineInput, type InlineSegment } from "./parser/inline-input.ts";
import { InlineParser } from "./parser/inline-parser.ts";
import { isFlowJsxChildren } from "./parser/materialize-jsx.ts";
import {
  materializeDocument,
  materializePhrasing,
  materializePhrasingGroups,
} from "./parser/materialize.ts";
import { sourceText } from "./source.ts";

/** Lowers MDX siblings in the scope of the block that contains the open leaf. */
export type LowerNodes = (nodes: readonly MdxNode[], previous?: MdxNode) => HtmlNode[];

export interface OpenLeafContext {
  readonly file: SourceFile;
  readonly syntax: ResolvedSyntaxOptions;
  readonly limits: ResolvedParserLimits;
  /** Code text of the open fence, extended by later appends. */
  readonly fence: FenceText;
  /** Work on the open paragraph that later appends reuse. */
  readonly paragraph: OpenParagraph;
  readonly phrasing: PhrasingCache;
  /** Lowering resolves references through this cache; a new one means new definitions. */
  readonly lowering: HtmlLoweringCache;
}

/** One inline node of the open paragraph with its materialized and lowered output. */
interface InlineGroup {
  readonly node: PhrasingContent | undefined;
  /** Totals through this group, so a reused prefix needs no new pass. */
  readonly htmlEnd: number;
  readonly nodeEnd: number;
}

/** Children of a long open paragraph are grouped into fragments of this size. */
const chunkSize = 64;

/**
 * The open paragraph's input, resumable inline parse, and the output of its
 * leading inline nodes. The paragraph owns these arrays and truncates and
 * extends them in place, so an append decodes, parses, materializes, and
 * lowers only what changed.
 */
export class OpenParagraph {
  #start = -1;
  #lowering: HtmlLoweringCache | undefined;
  #input: InlineInput | undefined;
  #parser: InlineParser | undefined;
  readonly #groups: InlineGroup[] = [];
  readonly #children: HtmlNode[] = [];
  /** Fragments of full chunks of `#children`, reused while their nodes are unchanged. */
  readonly #chunks: HtmlRootNode[] = [];
  /** Footnote numbers can change while the paragraph is open, so groups from here render again. */
  #numbered = Infinity;

  /** Starts tracking the paragraph at `start`, dropping work done for another. */
  public open(start: number, lowering: HtmlLoweringCache): void {
    if (this.#start !== start) {
      this.#start = start;
      this.#input = undefined;
      this.truncate(0);
    }

    if (this.#lowering !== lowering) {
      this.#lowering = lowering;
      this.truncate(0);
    }
  }

  public parse(
    file: SourceFile,
    segments: readonly InlineSegment[],
    syntax: ResolvedSyntaxOptions,
  ): ReturnType<InlineParser["parse"]> {
    this.#parser ??= new InlineParser(syntax);
    this.#input = new InlineInput(file, segments, this.#input);

    return this.#parser.parse(this.#input);
  }

  /** The last materialized node, which decides how text after a hard break renders. */
  public get lastNode(): PhrasingContent | undefined {
    return this.#groups.at(-1)?.node;
  }

  /** The unchanged prefix, capped where footnote numbering must be refreshed. */
  public reusable(changedFrom: number): number {
    const groups = this.#groups;
    let low = Math.min(groups.length, changedFrom, this.#numbered);

    // The group after a reused hard break must render again with that context.
    while (low > 0 && groups[low - 1].node?.kind === "hardBreak") {
      low--;
    }

    return low;
  }

  /** Keeps the first `length` groups and returns how many nodes they materialized. */
  public truncate(length: number): number {
    this.#groups.length = length;
    const last = this.#groups.at(-1);
    this.#children.length = last?.htmlEnd ?? 0;
    this.#chunks.length = Math.min(
      this.#chunks.length,
      Math.floor(this.#children.length / chunkSize),
    );

    if (length === 0) {
      this.#numbered = Infinity;
    }

    return last?.nodeEnd ?? 0;
  }

  public push(
    node: PhrasingContent | undefined,
    html: readonly HtmlNode[],
    nodeEnd: number,
    numbered: boolean,
  ): void {
    this.#children.push(...html);
    this.#groups.push({ node, htmlEnd: this.#children.length, nodeEnd });

    if (numbered) {
      this.#numbered = Math.min(this.#numbered, this.#groups.length - 1);
    }
  }

  /**
   * The rendered children for a snapshot. A long paragraph groups full chunks
   * into fragments that keep their identity, so a snapshot copies only the
   * chunk list and the last partial chunk.
   */
  public children(): HtmlNode[] {
    const children = this.#children;

    if (children.length < chunkSize * 2) {
      return [...children];
    }

    while ((this.#chunks.length + 1) * chunkSize <= children.length) {
      const start = this.#chunks.length * chunkSize;
      this.#chunks.push(
        Object.freeze({ kind: "root", children: children.slice(start, start + chunkSize) }),
      );
    }

    return [...this.#chunks, ...children.slice(this.#chunks.length * chunkSize)];
  }
}

/** The open leaf's rendering, and the nodes it materialized for the node limit. */
export interface OpenLeafHtml {
  readonly nodes: readonly HtmlNode[];
  readonly nodeCount: number;
}

/**
 * Renders the open leaf of a stream. The materializer leaves an empty
 * placeholder with the leaf's origin, and lowering asks this function for the
 * placeholder's HTML.
 */
export function lowerOpenLeaf(
  node: MdxNode,
  pending: PendingBlockSyntax,
  context: OpenLeafContext,
  lower: LowerNodes,
): OpenLeafHtml | undefined {
  if (node.origin?.start !== pending.range.start || node.origin.end !== pending.range.end) {
    return undefined;
  }

  switch (pending.kind) {
    case "paragraph":
      return node.kind === "paragraph" ? openParagraph(pending, context, lower) : undefined;
    case "fencedCode":
      return node.kind === "codeBlock"
        ? {
            nodes: [
              pendingNode("fence", context.file.slice(pending.range), pending.range, {
                children: [
                  text(context.fence.text(context.file, pending.range.start, pending.value)),
                ],
                language:
                  pending.language === undefined
                    ? undefined
                    : context.file.semanticSlice(pending.language),
                meta:
                  pending.meta === undefined ? undefined : context.file.semanticSlice(pending.meta),
              }),
            ],
            nodeCount: 0,
          }
        : undefined;
    case "math":
      return node.kind === "displayMath"
        ? {
            nodes: [
              pendingNode("displayMath", context.file.semanticSlice(pending.range), pending.range, {
                children: [
                  text(
                    new InlineInput(context.file, pending.value)
                      .toString()
                      .replace(/\r\n?|\n/gu, "\n")
                      .replace(/\n$/u, ""),
                  ),
                ],
              }),
            ],
            nodeCount: 0,
          }
        : undefined;
    case "jsx":
      return node.kind === "rawHtmlBlock" ? openJsx(pending, context, lower) : undefined;
    case "expression":
      return node.kind === "rawHtmlBlock"
        ? {
            nodes: [
              pendingNode("expression", context.file.semanticSlice(pending.range), pending.range, {
                children: [text(context.file.semanticSlice(pending.range))],
              }),
            ],
            nodeCount: 0,
          }
        : undefined;
    case "esm":
      return node.kind === "rawHtmlBlock"
        ? {
            nodes: [pendingNode("esm", context.file.slice(pending.range), pending.range)],
            nodeCount: 0,
          }
        : undefined;
  }
}

/** A paragraph whose last construct is still open renders that construct as a pending node. */
function openParagraph(
  pending: Extract<PendingBlockSyntax, { kind: "paragraph" }>,
  context: OpenLeafContext,
  lower: LowerNodes,
): OpenLeafHtml {
  const cache = context.paragraph;
  cache.open(pending.range.start, context.lowering);
  const parsed = cache.parse(context.file, pending.input, context.syntax);
  const open = parsed.pending;
  const boundary = open?.range.start ?? Infinity;
  const nodes = parsed.nodes;
  const reused = cache.reusable(parsed.changedFrom);
  let nodeCount = cache.truncate(reused);
  const changed: InlineSyntax[] = [];

  for (let index = reused; index < nodes.length; index++) {
    const node = nodes[index];

    if (node.range.start >= boundary) {
      break;
    }

    if (node.range.end > boundary && node.kind !== "text") {
      break;
    }

    // Text that runs into the open construct ends where it starts.
    const range = { start: node.range.start, end: boundary };

    const inline: InlineSyntax =
      node.range.end <= boundary
        ? node
        : { kind: "text", value: context.file.semanticSlice(range), range };

    changed.push(inline);
  }

  const groups = materializePhrasingGroups(
    context.file,
    changed,
    context.syntax,
    context.limits,
    context.phrasing,
  );

  for (const materialized of groups) {
    nodeCount += materialized.nodeCount;

    cache.push(
      materialized.nodes.at(-1),
      lower(materialized.nodes, cache.lastNode),
      nodeCount,
      materialized.nodes.some((child) => footnoteReferences(child).length > 0),
    );
  }

  const children = cache.children();

  if (open !== undefined) {
    const lowered = openInline(open, context, lower);
    children.push(lowered.node);
    nodeCount += lowered.nodeCount;
  }

  const paragraph: HtmlElementNode = {
    kind: "element",
    tagName: "p",
    attributes: {},
    children,
    origin: pending.range,
  };

  return { nodes: [paragraph], nodeCount };
}

interface OpenInlineHtml {
  readonly node: HtmlPendingNode;
  readonly nodeCount: number;
}

function openInline(
  open: InlinePendingSyntax,
  context: OpenLeafContext,
  lower: LowerNodes,
): OpenInlineHtml {
  const source = context.file.slice(open.range);

  switch (open.kind) {
    case "strong":
    case "emphasis":
    case "delete":
    case "link": {
      const materialized = materializePhrasing(
        context.file,
        open.children,
        context.syntax,
        context.limits,
      );

      return {
        node: pendingNode(open.kind, source, open.range, { children: lower(materialized.nodes) }),
        nodeCount: materialized.nodeCount,
      };
    }

    case "code":
      return {
        node: pendingNode("code", source, open.range, { children: [text(open.value)] }),
        nodeCount: 0,
      };
    case "image":
      return {
        node: pendingNode("image", source, open.range, { children: [text(open.alt)] }),
        nodeCount: 0,
      };
    case "math":
      return {
        node: pendingNode("inlineMath", context.file.semanticSlice(open.range), open.range, {
          children: [text(open.value)],
        }),
        nodeCount: 0,
      };
    case "expression":
      return {
        node: pendingNode("expression", context.file.semanticSlice(open.range), open.range, {
          children: [text(context.file.semanticSlice(open.range))],
        }),
        nodeCount: 0,
      };
    case "jsx":
      return { node: pendingNode("jsx", source, open.range), nodeCount: 0 };
  }
}

/**
 * Open flow JSX with a committed opening tag renders as pending JSX with its
 * children so far. An opening tag with expression attributes stays inert.
 */
function openJsx(
  pending: Extract<PendingBlockSyntax, { kind: "jsx" }>,
  context: OpenLeafContext,
  lower: LowerNodes,
): OpenLeafHtml {
  const authored = context.file.slice(pending.range);
  const opening = pending.opening;

  if (opening === undefined || !opening.safe || opening.name === undefined) {
    return { nodes: [pendingNode("jsx", authored, pending.range)], nodeCount: 0 };
  }

  const children: HtmlNode[] = [];
  let nodeCount = 0;

  if (opening.end !== undefined && opening.end < authored.length) {
    const range = { start: pending.range.start + opening.end, end: pending.range.end };
    const flow = isFlowJsxChildren(context.file, range);

    const drafts: readonly BlockSyntax[] = flow
      ? parseFlowRange(sourceText(context.file).grammar(), range, context.syntax)
      : [{ kind: "paragraph", range, input: [{ kind: "source", range }] }];

    const materialized = materializeDocument(context.file, drafts, context.syntax, context.limits, {
      keepReferences: true,
      allowIncomplete: true,
    });

    if (materialized.kind === "ok") {
      const lowered = lower(materialized.document.children);
      const paragraph = lowered[0];

      // Children on the opening line are phrasing, so they are not wrapped in a paragraph.
      children.push(
        ...(!flow && paragraph?.kind === "element" && paragraph.tagName === "p"
          ? paragraph.children
          : lowered),
      );
      nodeCount = materialized.blocks.reduce((count, block) => count + block.nodeCount, 0);
    }
  }

  return {
    nodes: [
      {
        kind: "jsx",
        state: "pending",
        element: "flow",
        name: opening.name,
        attributes: committedAttributes(opening),
        fallback: authored,
        children,
        origin: pending.range,
      },
    ],
    nodeCount,
  };
}

function committedAttributes(opening: CommittedJsxOpening): JsxAttributeLike[] {
  return Object.entries(opening.attributes).flatMap(([name, value]): JsxAttributeLike[] =>
    value === false
      ? []
      : [{ kind: "jsxAttribute", name, value: value === true ? undefined : value }],
  );
}

/**
 * The code of an open fence. Complete lines never change while the fence stays
 * open, so each append decodes only the lines that arrived since the last one.
 */
export class FenceText {
  #start = -1;
  #complete = 0;
  #last: SourceRange | undefined;
  #text = "";

  public text(file: SourceFile, start: number, segments: PendingFenceSegments): string {
    const reusable =
      this.#start === start &&
      this.#complete <= segments.length &&
      (this.#complete === 0 || sameRange(segment(segments, this.#complete - 1), this.#last));

    if (!reusable) {
      this.#start = start;
      this.#complete = 0;
      this.#last = undefined;
      this.#text = "";
    }

    // The last segment can be a partial line, so only earlier segments are kept.
    const complete = Math.max(this.#complete, segments.length - 1);

    if (complete > this.#complete) {
      this.#text += normalizeLineEndings(
        new InlineInput(file, segments.slice(this.#complete, complete)).toString(),
      );
      this.#complete = complete;
      this.#last = segment(segments, complete - 1);
    }

    const tail = segments.slice(complete);

    return tail.length === 0
      ? this.#text
      : this.#text + normalizeLineEndings(new InlineInput(file, tail).toString());
  }
}

type PendingFenceSegments = Extract<PendingBlockSyntax, { kind: "fencedCode" }>["value"];

function segment(segments: PendingFenceSegments, index: number): SourceRange | undefined {
  const value = segments[index];

  return value?.kind === "source" ? value.range : undefined;
}

function sameRange(left: SourceRange | undefined, right: SourceRange | undefined): boolean {
  return left?.start === right?.start && left?.end === right?.end;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

const trimmableTailTags: ReadonlySet<string> = new Set([
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "ul",
]);

/**
 * Removes empty trailing containers from the open end of a stream. A bare list
 * marker, heading marker, or quote marker can still become other syntax, so it
 * renders nothing until content arrives.
 */
export function trimOpenTail(nodes: readonly HtmlNode[]): readonly HtmlNode[] {
  let index = nodes.length - 1;

  while (index >= 0 && isWhitespaceText(nodes[index])) {
    index--;
  }

  const last = nodes[index];

  // Long previews group children into fragments, which are transparent here.
  const transparent = last?.kind === "root";

  if (!transparent && (last?.kind !== "element" || !trimmableTailTags.has(last.tagName))) {
    return nodes;
  }

  const nested = trimOpenTail(last.children);

  if (nested.every(isWhitespaceText)) {
    return nodes.slice(0, index);
  }

  return nested === last.children
    ? nodes
    : [...nodes.slice(0, index), { ...last, children: nested }, ...nodes.slice(index + 1)];
}

function isWhitespaceText(node: HtmlNode | undefined): boolean {
  return node?.kind === "text" && node.value.trim() === "";
}

function pendingNode(
  construct: HtmlPendingNode["construct"],
  source: string,
  origin: SourceRange,
  fields: Partial<Pick<HtmlPendingNode, "children" | "language" | "meta">> = {},
): HtmlPendingNode {
  return {
    kind: "pending",
    construct,
    source,
    children: fields.children ?? [],
    language: fields.language,
    meta: fields.meta,
    origin,
  };
}

function text(value: string): HtmlNode {
  return { kind: "text", value };
}
