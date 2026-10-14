import { isObject } from "@temelj/value";

import type { HtmlAttributes, HtmlElementNode, HtmlNode } from "./html.ts";
import type {
  DocumentNode,
  FlowContent,
  FootnoteReferenceNode,
  JsxAttributeLike,
  MdxNode,
  SourceRange,
} from "./model.ts";
import type { BlockSyntax, PendingBlockSyntax } from "./parser/block-syntax.ts";
import type { ResolvedParserLimits } from "./parser/config.ts";
import type { InlinePendingSyntax, InlineSyntax } from "./parser/inline-syntax.ts";
import type { ReferenceCandidate } from "./parser/materialize.ts";
import type { OwnedBlock, StreamDependencies } from "./stream-types.ts";
import type { StreamingDocument, StreamingElement, StreamingNode } from "./streaming-document.ts";
import type { ResolvedSyntaxOptions } from "./syntax-options.ts";

import { lowerHtml, sanitizeUrl } from "./html-lower.ts";
import { htmlFallback } from "./html.ts";
import { mdxChildren } from "./model.ts";
import { parseFlowRange } from "./parser/block-parser.ts";
import { InlineInput } from "./parser/inline-input.ts";
import { parseInline } from "./parser/inline-parser.ts";
import { isFlowJsxChildren, materializeStrictDocument } from "./parser/materialize.ts";
import { SourceFile } from "./source.ts";

export function pendingStreamingDocument(
  block: Extract<BlockSyntax, { kind: "invalidMdx" }>,
  file: SourceFile,
  syntax: ResolvedSyntaxOptions,
  limits: ResolvedParserLimits,
): StreamingDocument {
  const authored = file.slice(block.range);

  if (block.syntax === "esm") {
    return { kind: "root", children: [Object.freeze({ kind: "pendingEsm", range: block.range })] };
  }

  if (block.syntax === "expression") {
    return {
      kind: "root",
      children: [
        Object.freeze({
          kind: "pendingExpression",
          authored,
          range: block.range,
        }),
      ],
    };
  }

  const name = block.opening?.name;
  const attributes = block.opening?.attributes ?? {};
  const safe = block.opening?.safe ?? false;
  let children: readonly StreamingNode[] = [];
  const openingEnd = block.opening?.end;

  if (safe && openingEnd !== undefined && openingEnd < authored.length) {
    const range = { start: block.range.start + openingEnd, end: block.range.end };
    const flow = isFlowJsxChildren(file.text, range);

    const drafts: readonly BlockSyntax[] = flow
      ? parseFlowRange(file.text.replaceAll("\0", "\uFFFD"), range, syntax)
      : [{ kind: "paragraph", range, input: [{ kind: "source", range }] }];

    const materialized = materializeStrictDocument(file, drafts, syntax, limits, true);

    if (materialized.kind === "ok") {
      const rendered = streamingDocument(materialized.document);
      const paragraph = rendered.children[0];
      children =
        !flow && paragraph?.kind === "element" && paragraph.tagName === "p"
          ? paragraph.children
          : rendered.children;
    }
  }

  return {
    kind: "root",
    children: [
      Object.freeze({
        kind: "jsx",
        state: "pending",
        safe,
        name,
        attributes: Object.freeze(attributes),
        children,
        authored,
        range: block.range,
      }),
    ],
  };
}

export function applyPendingBlock(
  blocks: readonly OwnedBlock[],
  pending: PendingBlockSyntax,
  file: SourceFile,
  syntax: ResolvedSyntaxOptions,
  limits: ResolvedParserLimits,
): readonly OwnedBlock[] {
  return blocks.map((block) => {
    if (block.range.start > pending.range.start || block.range.end < pending.range.end) {
      return block;
    }

    const streaming = projectPendingDocument(block.streaming, pending, file, syntax, limits);

    return streaming === block.streaming ? block : { ...block, streaming };
  });
}

/** Projects one pending leaf into the existing container structure. */
export function projectPendingDocument(
  document: StreamingDocument,
  pending: PendingBlockSyntax,
  file: SourceFile,
  syntax: ResolvedSyntaxOptions,
  limits: ResolvedParserLimits,
): StreamingDocument {
  const replace = (node: StreamingNode): StreamingNode => {
    const range = node.range;

    // Only nodes that contain the pending leaf can change.
    if (
      range !== undefined &&
      (range.start > pending.range.start || range.end < pending.range.end)
    ) {
      return node;
    }

    const exact = range?.start === pending.range.start && range.end === pending.range.end;

    const leaf =
      pending.kind === "paragraph"
        ? node.kind === "element" && node.tagName === "p"
        : node.kind !== "element" || node.tagName === "pre";

    if (exact && leaf) {
      const replacement =
        pending.kind === "jsx" || pending.kind === "expression" || pending.kind === "esm"
          ? pendingStreamingDocument(
              {
                kind: "invalidMdx",
                syntax: pending.kind,
                state: "incomplete",
                range: pending.range,
                opening: pending.kind === "jsx" ? pending.opening : undefined,
              },
              file,
              syntax,
              limits,
            )
          : pendingBlockStreamingDocument(pending, file, syntax, {
              kind: "root",
              children: [node],
            });

      return replacement?.children[0] ?? node;
    }

    if (node.kind === "footnoteSection" || node.kind === "footnoteReference") {
      const content = replace(node.content);

      return content === node.content || content.kind !== "element"
        ? node
        : Object.freeze({ ...node, content });
    }

    if (!("children" in node)) {
      return node;
    }

    let children = node.children.map(replace);

    if (pending.kind === "paragraph" && node.kind === "element" && node.tagName === "li") {
      const first = children.findIndex(
        (child) =>
          child.range !== undefined &&
          child.range.start >= pending.range.start &&
          child.range.end <= pending.range.end,
      );

      let last = first;

      while (
        last + 1 < children.length &&
        children[last + 1].range !== undefined &&
        (children[last + 1].range?.end ?? Infinity) <= pending.range.end
      ) {
        last++;
      }

      if (
        first !== -1 &&
        !children
          .slice(first, last + 1)
          .some((child) => child.kind === "element" && child.tagName === "p")
      ) {
        const settled: StreamingDocument = {
          kind: "root",
          children: [
            Object.freeze({
              kind: "element",
              tagName: "p",
              attributes: Object.freeze({}),
              children: Object.freeze(children.slice(first, last + 1)),
              range: pending.range,
            }),
          ],
        };

        const replacement = pendingBlockStreamingDocument(pending, file, syntax, settled)
          ?.children[0];

        if (replacement?.kind === "element") {
          children = [
            ...children.slice(0, first),
            ...replacement.children,
            ...children.slice(last + 1),
          ];
        }
      }
    }

    return children.every((child, index) => child === node.children[index]) &&
      children.length === node.children.length
      ? node
      : Object.freeze({ ...node, children: Object.freeze(children) });
  };

  const children = document.children.map(replace);

  return children.every((child, index) => child === document.children[index])
    ? document
    : { kind: "root", children: children };
}

function pendingBlockStreamingDocument(
  pending: PendingBlockSyntax,
  file: SourceFile,
  syntax: ResolvedSyntaxOptions,
  settled?: StreamingDocument,
): StreamingDocument | undefined {
  if (pending.kind === "fencedCode") {
    return {
      kind: "root",
      children: [
        Object.freeze({
          kind: "pendingFencedCode",
          authored: file.slice(pending.range),
          // A trailing line ending tells consumers the last line is complete.
          value: new InlineInput(file, pending.value).toString().replace(/\r\n?|\n/gu, "\n"),
          language:
            pending.language === undefined ? undefined : file.semanticSlice(pending.language),
          meta: pending.meta === undefined ? undefined : file.semanticSlice(pending.meta),
          range: pending.range,
        }),
      ],
    };
  }

  if (pending.kind === "math") {
    return {
      kind: "root",
      children: [
        Object.freeze({
          kind: "pendingMath",
          authored: file.semanticSlice(pending.range),
          value: new InlineInput(file, pending.value)
            .toString()
            .replace(/\r\n?|\n/gu, "\n")
            .replace(/\n$/u, ""),
          range: pending.range,
        }),
      ],
    };
  }

  if (pending.kind === "expression") {
    return {
      kind: "root",
      children: [
        Object.freeze({
          kind: "pendingExpression",
          authored: file.semanticSlice(pending.range),
          range: pending.range,
        }),
      ],
    };
  }

  if (pending.kind === "esm") {
    return {
      kind: "root",
      children: [Object.freeze({ kind: "pendingEsm", range: pending.range })],
    };
  }

  if (pending.kind === "jsx") {
    return {
      kind: "root",
      children: [
        Object.freeze({
          kind: "jsx",
          state: "pending",
          safe: false,
          attributes: Object.freeze({}),
          children: Object.freeze([]),
          authored: file.semanticSlice(pending.range),
          range: pending.range,
        }),
      ],
    };
  }

  if (pending.kind !== "paragraph") {
    return;
  }

  const parsed = parseInline(new InlineInput(file, pending.input), syntax);

  if (parsed.pending === undefined) {
    return;
  }

  const pendingInline = parsed.pending;
  const node = streamingPendingInline(pendingInline, file);
  const settledParagraph = settled?.children[0];
  const settledByRange = new Map<string, StreamingNode>();

  if (settledParagraph?.kind === "element" && settledParagraph.tagName === "p") {
    for (const child of settledParagraph.children) {
      if (child.range !== undefined) {
        settledByRange.set(rangeKey(child.range.start, child.range.end), child);
      }
    }
  }

  const prefix = parsed.nodes.flatMap((node): readonly StreamingNode[] => {
    if (node.range.end <= pendingInline.range.start) {
      return [
        settledByRange.get(rangeKey(node.range.start, node.range.end)) ??
          streamingInlineSyntax(node, file),
      ];
    }

    if (node.kind === "text" && node.range.start < pendingInline.range.start) {
      const range = Object.freeze({ start: node.range.start, end: pendingInline.range.start });

      return [Object.freeze({ kind: "text", value: file.semanticSlice(range), range })];
    }

    return [];
  });

  return {
    kind: "root",
    children: [
      Object.freeze({
        kind: "element",
        tagName: "p",
        attributes: Object.freeze({}),
        children: Object.freeze([...prefix, node]),
        range: pending.range,
      }),
    ],
  };
}

/** Renders invalid authored source as inert text. */
export function authoredStreamingDocument(
  file: SourceFile,
  range: Readonly<{ start: number; end: number }>,
): StreamingDocument {
  return {
    kind: "root",
    children: [
      Object.freeze({
        kind: "element",
        tagName: "p",
        attributes: Object.freeze({}),
        children: Object.freeze([
          Object.freeze({ kind: "text", value: file.semanticSlice(range).trimEnd(), range }),
        ]),
        range,
      }),
    ],
  };
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
export function trimStreamingTail(document: StreamingDocument): StreamingDocument {
  const children = trimTail(document.children);

  return children === document.children ? document : { kind: "root", children: children };
}

function trimTail(children: readonly StreamingNode[]): readonly StreamingNode[] {
  let index = children.length - 1;

  while (index >= 0 && isWhitespaceText(children[index])) {
    index--;
  }

  const last = children[index];

  if (last?.kind !== "element" || !trimmableTailTags.has(last.tagName)) {
    return children;
  }

  const nested = trimTail(last.children);

  if (nested.every(isWhitespaceText)) {
    return Object.freeze(children.slice(0, index));
  }

  return nested === last.children
    ? children
    : Object.freeze([
        ...children.slice(0, index),
        Object.freeze({ ...last, children: nested }),
        ...children.slice(index + 1),
      ]);
}

function isWhitespaceText(node: StreamingNode | undefined): boolean {
  return node?.kind === "text" && node.value.trim() === "";
}

function streamingPendingInline(pending: InlinePendingSyntax, file: SourceFile): StreamingNode {
  const authored = file.slice(pending.range);

  switch (pending.kind) {
    case "strong":
    case "emphasis":
    case "delete":
      return Object.freeze({
        kind:
          pending.kind === "strong"
            ? "pendingStrong"
            : pending.kind === "emphasis"
              ? "pendingEmphasis"
              : "pendingDelete",
        authored,
        children: Object.freeze(
          pending.children.map((child) => streamingInlineSyntax(child, file)),
        ),
        range: pending.range,
      });
    case "code":
      return Object.freeze({
        kind: "pendingCode",
        authored,
        value: pending.value,
        range: pending.range,
      });
    case "link":
      return Object.freeze({
        kind: "pendingLink",
        authored,
        children: Object.freeze(
          pending.children.map((child) => streamingInlineSyntax(child, file)),
        ),
        range: pending.range,
      });
    case "image":
      return Object.freeze({
        kind: "pendingImage",
        authored,
        alt: pending.alt,
        range: pending.range,
      });
    case "math":
      return Object.freeze({
        kind: "pendingMath",
        authored: file.semanticSlice(pending.range),
        value: pending.value,
        range: pending.range,
      });
    case "expression":
      return Object.freeze({
        kind: "pendingExpression",
        authored: file.semanticSlice(pending.range),
        range: pending.range,
      });
    case "jsx":
      return Object.freeze({
        kind: "jsx",
        state: "pending",
        safe: false,
        attributes: Object.freeze({}),
        children: Object.freeze([]),
        authored,
        range: pending.range,
      });
  }
}

function streamingInlineSyntax(node: InlineSyntax, file: SourceFile): StreamingNode {
  const children =
    "children" in node
      ? Object.freeze(node.children.map((child) => streamingInlineSyntax(child, file)))
      : Object.freeze([]);

  switch (node.kind) {
    case "text":
      return Object.freeze({ kind: "text", value: node.value, range: node.range });
    case "emphasis":
    case "strong":
    case "delete":
      return Object.freeze({
        kind: "element",
        tagName: node.kind === "emphasis" ? "em" : node.kind === "strong" ? "strong" : "del",
        attributes: Object.freeze({}),
        children,
        range: node.range,
      });
    case "code":
      return Object.freeze({
        kind: "element",
        tagName: "code",
        attributes: Object.freeze({}),
        children: Object.freeze([
          Object.freeze({ kind: "text", value: node.value, range: node.range }),
        ]),
        range: node.range,
      });
    case "hardBreak":
      return Object.freeze({
        kind: "element",
        tagName: "br",
        attributes: Object.freeze({}),
        children: Object.freeze([]),
        range: node.range,
      });
    case "link": {
      const href = sanitizeUrl(node.destination, {}, "link");
      const attributes: Record<string, HtmlAttributes[string]> = href === undefined ? {} : { href };

      return Object.freeze({
        kind: "element",
        tagName: "a",
        attributes: Object.freeze(attributes),
        children,
        range: node.range,
      });
    }

    case "image": {
      const src = sanitizeUrl(node.destination, {}, "image");

      const attributes: Record<string, HtmlAttributes[string]> =
        src === undefined ? { alt: node.alt } : { alt: node.alt, src };

      return Object.freeze({
        kind: "element",
        tagName: "img",
        attributes: Object.freeze(attributes),
        children: Object.freeze([]),
        range: node.range,
      });
    }

    case "reference":
    case "footnoteReference":
      return unresolvedReference(node, file.text);
    case "rawHtml":
      return Object.freeze({ kind: "raw", value: node.value, range: node.range });
    case "expression":
      return Object.freeze({
        kind: "pendingExpression",
        authored: file.semanticSlice(node.range),
        range: node.range,
      });
    case "jsx":
      return Object.freeze({
        kind: "jsx",
        state: "complete",
        safe: false,
        attributes: Object.freeze({}),
        children: Object.freeze([]),
        authored: node.value,
        range: node.range,
      });
    case "math":
      return Object.freeze({
        kind: "math",
        source: node.value,
        style: "inline",
        range: node.range,
      });
    case "directive":
      return Object.freeze({
        kind: "text",
        value: file.semanticSlice(node.range),
        range: node.range,
      });
  }
}

export function strictBlockDocument(node: FlowContent, complete: DocumentNode): DocumentNode {
  const definitions = complete.children.filter(
    (child) => child.kind === "definition" || child.kind === "footnoteDefinition",
  );

  return {
    kind: "document",
    children: [node, ...definitions.filter((definition) => definition !== node)],
    origin: node.origin,
  };
}

function streamingDocument(document: DocumentNode): StreamingDocument {
  return {
    kind: "root",
    children: lowerHtml(document).children.map((node) => streamingNode(node, new Map())),
  };
}

/** Streaming nodes converted from HTML node identities. Valid while references are unchanged. */
export type StreamingConversionCache = WeakMap<HtmlNode, StreamingNode>;

export function streamingDocumentFromHtml(
  nodes: readonly HtmlNode[],
  source: string,
  candidates: readonly ReferenceCandidate[] = [],
  cache?: StreamingConversionCache,
): StreamingDocument {
  const candidatesByRange = new Map(
    candidates.map((candidate) => [
      rangeKey(candidate.range.start, candidate.range.end),
      candidate,
    ]),
  );

  return {
    kind: "root",
    children: nodes.map((node) => streamingNode(node, candidatesByRange, source, cache)),
  };
}

function streamingNode(
  node: HtmlNode,
  candidates: ReadonlyMap<string, ReferenceCandidate>,
  source?: string,
  cache?: StreamingConversionCache,
): StreamingNode {
  const hit = cache?.get(node);

  if (hit !== undefined) {
    return hit;
  }

  const converted = convertStreamingNode(node, candidates, source, cache);
  cache?.set(node, converted);

  return converted;
}

function convertStreamingNode(
  node: HtmlNode,
  candidates: ReadonlyMap<string, ReferenceCandidate>,
  source: string | undefined,
  cache: StreamingConversionCache | undefined,
): StreamingNode {
  const range = sourceRange(node.origin);

  switch (node.kind) {
    case "footnoteReference":
      if (range === undefined || source === undefined) {
        throw new Error("A streaming footnote reference must retain its source range");
      }

      return Object.freeze({
        kind: "footnoteReference",
        authored: source.slice(range.start, range.end),
        identifier: node.identifier,
        occurrence: node.occurrence,
        ordinal: node.ordinal,
        content: streamingElement(htmlFallback(node), candidates, source, cache),
        range,
      });
    case "footnoteSection":
      return Object.freeze({
        kind: "footnoteSection",
        identifiers: node.identifiers,
        content: streamingElement(htmlFallback(node), candidates, source, cache),
        range,
      });
    case "codeBlock":
      return Object.freeze({
        kind: "codeBlock",
        code: node.code,
        language: node.language,
        meta: node.meta,
        range,
      });
    case "math":
      return Object.freeze({
        kind: "math",
        source: node.source,
        style: node.style,
        meta: node.meta,
        range,
      });
    case "jsx":
      return Object.freeze({
        kind: "jsx",
        state: "complete",
        safe: hasOnlyStaticAttributes(node.node.attributes),
        name: node.node.name,
        attributes: staticAttributes(node.node.attributes),
        children: Object.freeze(
          node.children.map((child) => streamingNode(child, candidates, source, cache)),
        ),
        authored: node.fallback,
        range,
      });
    case "expression":
      return Object.freeze({ kind: "text", value: node.fallback, range });
    case "element":
      return streamingElement(node, candidates, source, cache, range);
    case "text": {
      const candidate =
        range === undefined ? undefined : candidates.get(rangeKey(range.start, range.end));

      if (candidate !== undefined && source !== undefined) {
        return unresolvedReference(candidate, source);
      }

      return Object.freeze({ kind: "text", value: node.value, range });
    }

    case "raw":
      return Object.freeze({ kind: "raw", value: node.value, range });
    case "comment":
      return Object.freeze({ kind: "omitted", syntax: "comment", range });
    case "doctype":
      return Object.freeze({ kind: "omitted", syntax: "doctype", range });
    case "root":
      return Object.freeze({
        kind: "element",
        tagName: "span",
        attributes: Object.freeze({}),
        children: Object.freeze(
          node.children.map((child) => streamingNode(child, candidates, source, cache)),
        ),
        range,
      });
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function streamingElement(
  node: HtmlElementNode,
  candidates: ReadonlyMap<string, ReferenceCandidate>,
  source: string | undefined,
  cache: StreamingConversionCache | undefined,
  range = sourceRange(node.origin),
): StreamingElement {
  return Object.freeze({
    kind: "element",
    tagName: node.tagName,
    attributes: node.attributes,
    children: Object.freeze(
      node.children.map((child) => streamingNode(child, candidates, source, cache)),
    ),
    range,
  });
}

function staticAttributes(
  attributes: readonly JsxAttributeLike[],
): Readonly<Record<string, boolean | string>> {
  const entries: Array<readonly [string, boolean | string]> = [];

  for (const attribute of attributes) {
    if (attribute.kind === "jsxAttribute" && !isObject(attribute.value)) {
      entries.push([attribute.name, attribute.value ?? true]);
    }
  }

  return Object.freeze(Object.fromEntries(entries));
}

function hasOnlyStaticAttributes(attributes: readonly JsxAttributeLike[]): boolean {
  return attributes.every(
    (attribute) => attribute.kind === "jsxAttribute" && !isObject(attribute.value),
  );
}

/** References a node makes, in document order. Lists may repeat identifiers. */
export interface NodeReferences {
  readonly definitions: readonly string[];
  readonly footnotes: readonly string[];
  readonly footnoteReferences: readonly FootnoteReferenceNode[];
}

const noReferences: NodeReferences = { definitions: [], footnotes: [], footnoteReferences: [] };

/** Collects references, reusing results for node identities seen before. */
export function nodeReferences(
  node: MdxNode,
  cache: WeakMap<MdxNode, NodeReferences>,
): NodeReferences {
  const hit = cache.get(node);

  if (hit !== undefined) {
    return hit;
  }

  const definitions: string[] = [];
  const footnotes: string[] = [];
  const footnoteReferences: FootnoteReferenceNode[] = [];

  if (node.kind === "linkReference" || node.kind === "imageReference") {
    definitions.push(node.identifier);
  } else if (node.kind === "footnoteReference") {
    footnotes.push(node.identifier);
    footnoteReferences.push(node);
  }

  for (const child of mdxChildren(node)) {
    const references = nodeReferences(child, cache);
    definitions.push(...references.definitions);
    footnotes.push(...references.footnotes);
    footnoteReferences.push(...references.footnoteReferences);
  }

  const result =
    definitions.length === 0 && footnotes.length === 0
      ? noReferences
      : { definitions, footnotes, footnoteReferences };

  cache.set(node, result);

  return result;
}

export function dependenciesFor(
  references: NodeReferences,
  candidates: readonly ReferenceCandidate[] = [],
): StreamDependencies {
  const definitions = new Set<string>(references.definitions);
  const footnotes = new Set<string>(references.footnotes);

  for (const candidate of candidates) {
    if (candidate.kind === "reference") {
      definitions.add(candidate.identifier);
    } else {
      footnotes.add(candidate.identifier);
    }
  }

  return Object.freeze({
    definitions: Object.freeze([...definitions]),
    footnotes: Object.freeze([...footnotes]),
  });
}

function unresolvedReference(candidate: ReferenceCandidate, source: string): StreamingNode {
  const authored = source.slice(candidate.range.start, candidate.range.end);

  if (candidate.kind === "footnoteReference") {
    return Object.freeze({
      kind: "unresolvedFootnoteReference",
      authored,
      identifier: candidate.identifier,
      range: candidate.range,
    });
  }

  if (candidate.image) {
    return Object.freeze({
      kind: "unresolvedImageReference",
      authored,
      identifier: candidate.identifier,
      referenceKind: candidate.referenceKind,
      alt: candidate.children.map(inlineSyntaxText).join(""),
      range: candidate.range,
    });
  }

  return Object.freeze({
    kind: "unresolvedLinkReference",
    authored,
    identifier: candidate.identifier,
    referenceKind: candidate.referenceKind,
    children: Object.freeze(
      candidate.children.map((child) => streamingInlineSyntax(child, new SourceFile(source))),
    ),
    range: candidate.range,
  });
}

function inlineSyntaxText(node: InlineSyntax): string {
  if (node.kind === "text" || "value" in node) {
    return node.value;
  }

  if (node.kind === "image") {
    return node.alt;
  }

  if (node.kind === "reference" && node.image) {
    return node.children.map(inlineSyntaxText).join("");
  }

  if ("children" in node) {
    return node.children.map(inlineSyntaxText).join("");
  }

  return "";
}

function rangeKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function sourceRange(
  origin: SourceRange | undefined,
): Readonly<{ start: number; end: number }> | undefined {
  return origin === undefined ? undefined : Object.freeze({ start: origin.start, end: origin.end });
}
