import type { HtmlNode } from "./html.ts";
import type { DocumentNode, FlowContent, JsxAttributeLike, MdxNode, SourceSpan } from "./model.ts";
import type { BlockSyntax, PendingBlockSyntax } from "./parser/block-syntax.ts";
import type { ResolvedParserLimits } from "./parser/config.ts";
import type { InlinePendingSyntax, InlineSyntax } from "./parser/inline-syntax.ts";
import type { MaterializedBlock, ReferenceCandidate } from "./parser/materialize.ts";
import type { OwnedBlock, StreamDependencies } from "./stream-types.ts";
import type { StreamingNode } from "./streaming-document.ts";
import type { ResolvedSyntaxOptions } from "./syntax-options.ts";

import {
  HtmlCodeBlockNode,
  HtmlFootnoteReferenceNode,
  HtmlFootnoteSectionNode,
  HtmlMathNode,
  renderHtml,
} from "./html.ts";
import { DocumentNode as StrictDocumentNode } from "./model.ts";
import { InlineInput } from "./parser/inline-input.ts";
import { parseInline } from "./parser/inline-parser.ts";
import { materializeStrictDocument } from "./parser/materialize.ts";
import { SourceFile } from "./source.ts";
import { StreamingDocument } from "./streaming-document.ts";
import { walkTree } from "./tree.ts";

export function pendingStreamingDocument(
  block: Extract<BlockSyntax, { kind: "invalidMdx" }>,
  file: SourceFile,
  syntax: ResolvedSyntaxOptions,
  limits: ResolvedParserLimits,
): StreamingDocument {
  const authored = file.slice(block.range);
  if (block.syntax === "esm") {
    return new StreamingDocument([Object.freeze({ kind: "pendingEsm", range: block.range })]);
  }
  if (block.syntax === "expression") {
    return new StreamingDocument([
      Object.freeze({
        kind: "pendingExpression",
        authored,
        range: block.range,
      }),
    ]);
  }
  const name = /^<([A-Za-z_$][\w$:.-]*)/u.exec(authored)?.[1];
  const attributes: Record<string, boolean | string> = {};
  const attributePattern = /\s+([A-Za-z_$][\w$:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/gu;
  for (const match of authored.matchAll(attributePattern)) {
    attributes[match[1]] = match[2] ?? match[3] ?? true;
  }
  const safe = !/\{|\.\.\./u.test(authored);
  let children: readonly StreamingNode[] = [];
  const openingEnd = authored.indexOf(">");
  if (safe && openingEnd !== -1 && openingEnd + 1 < authored.length) {
    const childStart = block.range.start + openingEnd + 1;
    const childDraft: BlockSyntax = {
      kind: "paragraph",
      range: { start: childStart, end: block.range.end },
      input: [
        {
          kind: "source",
          range: { start: childStart, end: block.range.end },
        },
      ],
    };
    const materialized = materializeStrictDocument(file, [childDraft], syntax, limits);
    if (materialized.kind === "parsed") {
      const rendered = streamingDocument(materialized.document);
      const paragraph = rendered.children[0];
      children =
        paragraph?.kind === "element" && paragraph.tagName === "p"
          ? paragraph.children
          : rendered.children;
    }
  }
  return new StreamingDocument([
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
  ]);
}

export function applyPendingBlock(
  blocks: readonly OwnedBlock[],
  pending: PendingBlockSyntax,
  file: SourceFile,
  syntax: ResolvedSyntaxOptions,
): readonly OwnedBlock[] {
  let ownerIndex = -1;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.range.start <= pending.range.start && pending.range.end <= block.range.end) {
      ownerIndex = index;
      break;
    }
  }
  if (ownerIndex === -1) {
    return blocks;
  }
  const owner = blocks[ownerIndex];
  const document = pendingBlockStreamingDocument(pending, file, syntax, owner.streaming);
  if (document === undefined) {
    return blocks;
  }
  const next = [...blocks];
  next[ownerIndex] = { ...next[ownerIndex], streaming: document };
  return next;
}

function pendingBlockStreamingDocument(
  pending: PendingBlockSyntax,
  file: SourceFile,
  syntax: ResolvedSyntaxOptions,
  settled?: StreamingDocument,
): StreamingDocument | undefined {
  if (pending.kind === "fencedCode") {
    return new StreamingDocument([
      Object.freeze({
        kind: "pendingFencedCode",
        authored: file.slice(pending.range),
        value: new InlineInput(file, pending.value)
          .toString()
          .replace(/\r\n?|\n/gu, "\n")
          .replace(/\n$/u, ""),
        language: pending.language === undefined ? undefined : file.semanticSlice(pending.language),
        range: pending.range,
      }),
    ]);
  }
  if (pending.kind === "math") {
    return new StreamingDocument([
      Object.freeze({
        kind: "pendingMath",
        authored: file.semanticSlice(pending.range),
        value: new InlineInput(file, pending.value)
          .toString()
          .replace(/\r\n?|\n/gu, "\n")
          .replace(/\n$/u, ""),
        range: pending.range,
      }),
    ]);
  }
  if (pending.kind === "expression") {
    return new StreamingDocument([
      Object.freeze({
        kind: "pendingExpression",
        authored: file.semanticSlice(pending.range),
        range: pending.range,
      }),
    ]);
  }
  if (pending.kind === "esm") {
    return new StreamingDocument([Object.freeze({ kind: "pendingEsm", range: pending.range })]);
  }
  if (pending.kind === "jsx") {
    return new StreamingDocument([
      Object.freeze({
        kind: "jsx",
        state: "pending",
        safe: false,
        attributes: Object.freeze({}),
        children: Object.freeze([]),
        authored: file.semanticSlice(pending.range),
        range: pending.range,
      }),
    ]);
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
  return new StreamingDocument([
    Object.freeze({
      kind: "element",
      tagName: "p",
      attributes: Object.freeze({}),
      children: Object.freeze([...prefix, node]),
      range: pending.range,
    }),
  ]);
}

export function applyAmbiguousMarkerBlock(
  blocks: readonly OwnedBlock[],
  file: SourceFile,
): readonly OwnedBlock[] {
  const match = /(?:^|(?:\r\n|\r|\n){2})([ \t]{0,3}(?:[*+-]|\d{1,9}[.)])[ \t]*)$/u.exec(file.text);
  const authored = match?.[1];
  const block = blocks.at(-1);
  if (match === null || authored === undefined || block === undefined) {
    return blocks;
  }
  const start = file.text.length - authored.length;
  if (start < block.range.start || start > block.range.end) {
    return blocks;
  }
  const next = [...blocks];
  next[next.length - 1] = {
    ...block,
    streaming: new StreamingDocument([
      Object.freeze({
        kind: "text",
        value: file.semanticSlice({ start, end: file.text.length }),
        range: Object.freeze({ start, end: file.text.length }),
      }),
    ]),
  };
  return next;
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
    case "link":
      return Object.freeze({
        kind: "element",
        tagName: "a",
        attributes: Object.freeze({ href: node.destination }),
        children,
        range: node.range,
      });
    case "image":
      return Object.freeze({
        kind: "element",
        tagName: "img",
        attributes: Object.freeze({ alt: node.alt, src: node.destination }),
        children: Object.freeze([]),
        range: node.range,
      });
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
        math: Object.freeze({ source: node.value, style: "inline" }),
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
  return new StrictDocumentNode(
    [node, ...definitions.filter((definition) => definition !== node)],
    node.origin,
  );
}

export function streamingDocument(
  document: DocumentNode,
  source?: string,
  candidates: readonly ReferenceCandidate[] = [],
): StreamingDocument {
  if (source !== undefined && hasOpenTexMath(source)) {
    return new StreamingDocument([
      Object.freeze({
        kind: "element",
        tagName: "p",
        attributes: Object.freeze({}),
        children: Object.freeze([Object.freeze({ kind: "text", value: source })]),
      }),
    ]);
  }
  const candidatesByRange = new Map(
    candidates.map((candidate) => [
      rangeKey(candidate.range.start, candidate.range.end),
      candidate,
    ]),
  );
  return new StreamingDocument(
    renderHtml(document).children.map((node) => streamingNode(node, candidatesByRange, source)),
  );
}

export function streamingDocuments(
  document: DocumentNode,
  blocks: readonly MaterializedBlock[],
  source: string,
): Readonly<{
  blocks: ReadonlyMap<FlowContent, StreamingDocument>;
  supplement: StreamingDocument;
}> {
  const rendered = renderHtml(document);
  const htmlByBlock = new Map<FlowContent, HtmlNode[]>();
  const blocksByOrigin = new Map<string, MaterializedBlock>();
  for (const block of blocks) {
    htmlByBlock.set(block.node, []);
    const origin = block.node.origin;
    if (origin !== undefined) {
      blocksByOrigin.set(rangeKey(origin.start, origin.end), block);
    }
  }
  const supplement: HtmlNode[] = [];
  let active: HtmlNode[] | undefined;
  for (const node of rendered.children) {
    if (isFootnoteSection(node)) {
      supplement.push(node);
      active = undefined;
      continue;
    }
    if (node.origin !== undefined) {
      const owner = blocksByOrigin.get(rangeKey(node.origin.start, node.origin.end));
      active = owner === undefined ? undefined : htmlByBlock.get(owner.node);
    }
    active?.push(node);
  }
  const streamingByBlock = new Map<FlowContent, StreamingDocument>();
  for (const block of blocks) {
    streamingByBlock.set(
      block.node,
      streamingDocumentFromHtml(htmlByBlock.get(block.node) ?? [], source, block.candidates),
    );
  }
  return Object.freeze({
    blocks: streamingByBlock,
    supplement: streamingDocumentFromHtml(supplement, source),
  });
}

function streamingDocumentFromHtml(
  nodes: readonly HtmlNode[],
  source: string,
  candidates: readonly ReferenceCandidate[] = [],
): StreamingDocument {
  const candidatesByRange = new Map(
    candidates.map((candidate) => [
      rangeKey(candidate.range.start, candidate.range.end),
      candidate,
    ]),
  );
  return new StreamingDocument(nodes.map((node) => streamingNode(node, candidatesByRange, source)));
}

function isFootnoteSection(node: HtmlNode): boolean {
  return node.kind === "element" && Object.hasOwn(node.attributes, "data-footnotes");
}

function hasOpenTexMath(source: string): boolean {
  const inline = source.lastIndexOf("\\(") > source.lastIndexOf("\\)");
  const display = source.lastIndexOf("\\[") > source.lastIndexOf("\\]");
  return inline || display;
}

function streamingNode(
  node: HtmlNode,
  candidates: ReadonlyMap<string, ReferenceCandidate> = new Map(),
  source?: string,
): StreamingNode {
  const range = sourceRange(node.origin);
  if (node instanceof HtmlFootnoteReferenceNode) {
    if (range === undefined || source === undefined) {
      throw new Error("A streaming footnote reference must retain its source range");
    }
    return Object.freeze({
      kind: "footnoteReference",
      authored: source.slice(range.start, range.end),
      identifier: node.footnoteReference.identifier,
      occurrence: node.footnoteReference.occurrence,
      ordinal: node.footnoteReference.ordinal,
      content: streamingElement(node, candidates, source),
      range,
    });
  }
  if (node instanceof HtmlFootnoteSectionNode) {
    return Object.freeze({
      kind: "footnoteSection",
      identifiers: node.footnoteSection.identifiers,
      content: streamingElement(node, candidates, source),
      range,
    });
  }
  if (node instanceof HtmlCodeBlockNode) {
    return Object.freeze({ kind: "codeBlock", codeBlock: node.codeBlock, range });
  }
  if (node instanceof HtmlMathNode) {
    return Object.freeze({ kind: "math", math: node.math, range });
  }
  switch (node.kind) {
    case "jsx":
      return Object.freeze({
        kind: "jsx",
        state: "complete",
        safe: hasOnlyStaticAttributes(node.request.node.attributes),
        name: node.request.node.name,
        attributes: staticAttributes(node.request.node.attributes),
        children: Object.freeze(
          node.request.children.map((child) => streamingNode(child, candidates, source)),
        ),
        authored: node.value,
        range,
      });
    case "element":
      return streamingElement(node, candidates, source);
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
    case "fragment":
      return Object.freeze({
        kind: "element",
        tagName: "span",
        attributes: Object.freeze({}),
        children: Object.freeze(
          node.children.map((child) => streamingNode(child, candidates, source)),
        ),
        range,
      });
    case "document":
      return Object.freeze({ kind: "omitted", syntax: "esm", range });
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function streamingElement(
  node: Extract<HtmlNode, { kind: "element" }>,
  candidates: ReadonlyMap<string, ReferenceCandidate>,
  source: string | undefined,
): Extract<StreamingNode, { kind: "element" }> {
  return Object.freeze({
    kind: "element",
    tagName: node.tagName,
    attributes: node.attributes,
    children: Object.freeze(node.children.map((child) => streamingNode(child, candidates, source))),
    range: sourceRange(node.origin),
  });
}

function staticAttributes(
  attributes: readonly JsxAttributeLike[],
): Readonly<Record<string, boolean | string>> {
  const entries: Array<readonly [string, boolean | string]> = [];
  for (const attribute of attributes) {
    if (attribute.kind === "jsxSpreadAttribute") {
      continue;
    }
    const value = attribute.value;
    if (typeof value === "object") {
      continue;
    }
    entries.push([attribute.name, value ?? true]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function hasOnlyStaticAttributes(attributes: readonly JsxAttributeLike[]): boolean {
  return attributes.every(
    (attribute) => attribute.kind === "jsxAttribute" && typeof attribute.value !== "object",
  );
}

export function dependenciesFor(
  node: FlowContent,
  candidates: readonly ReferenceCandidate[] = [],
): StreamDependencies {
  const definitions = new Set<string>();
  const footnotes = new Set<string>();
  for (const cursor of walkTree<MdxNode>(node, (value) => value.children)) {
    if (cursor.node.kind === "linkReference" || cursor.node.kind === "imageReference") {
      definitions.add(cursor.node.identifier);
    } else if (cursor.node.kind === "footnoteReference") {
      footnotes.add(cursor.node.identifier);
    }
  }
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
  origin: Readonly<SourceSpan> | undefined,
): Readonly<{ start: number; end: number }> | undefined {
  return origin === undefined ? undefined : Object.freeze({ start: origin.start, end: origin.end });
}
