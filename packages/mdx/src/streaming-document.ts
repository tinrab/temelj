import type { CodeBlockRenderInput, HtmlAttributeValue, MathRenderInput } from "./html.ts";

export type StreamingNode =
  | StreamingElement
  | StreamingJsx
  | StreamingText
  | StreamingRaw
  | StreamingOmitted
  | StreamingCodeBlock
  | StreamingMath
  | StreamingPendingStrong
  | StreamingPendingEmphasis
  | StreamingPendingDelete
  | StreamingPendingCode
  | StreamingPendingLink
  | StreamingPendingImage
  | StreamingPendingMath
  | StreamingPendingFencedCode
  | StreamingUnresolvedLinkReference
  | StreamingUnresolvedImageReference
  | StreamingUnresolvedFootnoteReference
  | StreamingFootnoteReference
  | StreamingFootnoteSection
  | StreamingPendingExpression
  | StreamingPendingEsm;

export type StreamingPendingMarkdownNode =
  | StreamingPendingStrong
  | StreamingPendingEmphasis
  | StreamingPendingDelete
  | StreamingPendingCode
  | StreamingPendingLink
  | StreamingPendingImage
  | StreamingPendingFencedCode
  | StreamingUnresolvedLinkReference
  | StreamingUnresolvedImageReference
  | StreamingUnresolvedFootnoteReference
  | StreamingFootnoteReference
  | StreamingFootnoteSection;

export interface StreamingElement {
  readonly kind: "element";
  readonly tagName: string;
  readonly attributes: Readonly<Record<string, HtmlAttributeValue>>;
  readonly children: readonly StreamingNode[];
  readonly range?: Readonly<{ start: number; end: number }>;
}

export interface StreamingJsx {
  readonly kind: "jsx";
  readonly state: "complete" | "pending";
  readonly safe: boolean;
  readonly name?: string;
  readonly attributes: Readonly<Record<string, boolean | string>>;
  readonly children: readonly StreamingNode[];
  readonly authored: string;
  readonly range?: Readonly<{ start: number; end: number }>;
}

export interface StreamingText {
  readonly kind: "text";
  readonly value: string;
  readonly range?: Readonly<{ start: number; end: number }>;
}

export interface StreamingRaw {
  readonly kind: "raw";
  readonly value: string;
  readonly range?: Readonly<{ start: number; end: number }>;
}

export interface StreamingOmitted {
  readonly kind: "omitted";
  readonly syntax: "comment" | "doctype" | "esm";
  readonly range?: Readonly<{ start: number; end: number }>;
}

export interface StreamingMath {
  readonly kind: "math";
  readonly math: MathRenderInput;
  readonly range?: Readonly<{ start: number; end: number }>;
}

export interface StreamingCodeBlock {
  readonly kind: "codeBlock";
  readonly codeBlock: CodeBlockRenderInput;
  readonly range?: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingStrong {
  readonly kind: "pendingStrong";
  readonly authored: string;
  readonly children: readonly StreamingNode[];
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingEmphasis {
  readonly kind: "pendingEmphasis";
  readonly authored: string;
  readonly children: readonly StreamingNode[];
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingDelete {
  readonly kind: "pendingDelete";
  readonly authored: string;
  readonly children: readonly StreamingNode[];
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingCode {
  readonly kind: "pendingCode";
  readonly authored: string;
  readonly value: string;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingLink {
  readonly kind: "pendingLink";
  readonly authored: string;
  readonly children: readonly StreamingNode[];
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingImage {
  readonly kind: "pendingImage";
  readonly authored: string;
  readonly alt: string;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingMath {
  readonly kind: "pendingMath";
  readonly authored: string;
  readonly value: string;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingFencedCode {
  readonly kind: "pendingFencedCode";
  readonly authored: string;
  readonly value: string;
  readonly language?: string;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingUnresolvedLinkReference {
  readonly kind: "unresolvedLinkReference";
  readonly authored: string;
  readonly identifier: string;
  readonly referenceKind: "full" | "collapsed" | "shortcut";
  readonly children: readonly StreamingNode[];
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingUnresolvedImageReference {
  readonly kind: "unresolvedImageReference";
  readonly authored: string;
  readonly identifier: string;
  readonly referenceKind: "full" | "collapsed" | "shortcut";
  readonly alt: string;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingUnresolvedFootnoteReference {
  readonly kind: "unresolvedFootnoteReference";
  readonly authored: string;
  readonly identifier: string;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingFootnoteReference {
  readonly kind: "footnoteReference";
  readonly authored: string;
  readonly identifier: string;
  readonly occurrence: number;
  readonly ordinal: number;
  readonly content: StreamingElement;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingFootnoteSection {
  readonly kind: "footnoteSection";
  readonly identifiers: readonly string[];
  readonly content: StreamingElement;
  readonly range?: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingExpression {
  readonly kind: "pendingExpression";
  readonly authored: string;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface StreamingPendingEsm {
  readonly kind: "pendingEsm";
  readonly range: Readonly<{ start: number; end: number }>;
}

/** Immutable provisional tree. Strict compiler and plugin APIs do not accept this type. */
export class StreamingDocument {
  public readonly children: readonly StreamingNode[];

  public constructor(children: readonly StreamingNode[]) {
    this.children = Object.freeze([...children]);
    Object.freeze(this);
  }
}

export function renderStreamingHtml(document: StreamingDocument): string {
  return document.children.map(renderStreamingNode).join("");
}

function renderStreamingNode(node: StreamingNode): string {
  switch (node.kind) {
    case "text":
    case "raw":
      return escapeHtml(node.value);
    case "omitted":
    case "pendingEsm":
      return "";
    case "pendingExpression":
      return escapeHtml(node.authored);
    case "unresolvedLinkReference":
    case "unresolvedImageReference":
    case "unresolvedFootnoteReference":
      return escapeHtml(node.authored);
    case "footnoteReference":
    case "footnoteSection":
      return renderStreamingNode(node.content);
    case "pendingImage":
      return escapeHtml(node.alt);
    case "pendingCode":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "pendingMath":
      return escapeHtml(node.authored);
    case "codeBlock": {
      const language = escapeHtml(node.codeBlock.language);
      const code = escapeHtml(node.codeBlock.code.length === 0 ? "" : `${node.codeBlock.code}\n`);
      return `<pre><code class="language-${language}">${code}</code></pre>`;
    }
    case "math":
      return renderMathFallback(node.math);
    case "pendingFencedCode":
      return `<pre><code>${escapeHtml(node.value)}</code></pre>`;
    case "pendingStrong":
      return `<strong>${node.children.map(renderStreamingNode).join("")}</strong>`;
    case "pendingEmphasis":
      return `<em>${node.children.map(renderStreamingNode).join("")}</em>`;
    case "pendingDelete":
      return `<del>${node.children.map(renderStreamingNode).join("")}</del>`;
    case "pendingLink":
      return `<span>${node.children.map(renderStreamingNode).join("")}</span>`;
    case "jsx":
      return escapeHtml(node.authored);
    case "element": {
      const attributes = Object.entries(node.attributes)
        .map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`)
        .join("");
      return `<${node.tagName}${attributes}>${node.children.map(renderStreamingNode).join("")}</${node.tagName}>`;
    }
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function renderMathFallback(math: MathRenderInput): string {
  const source = escapeHtml(math.source);
  if (math.style === "inline") {
    return `<code class="language-math math-inline">${source}</code>`;
  }
  const metadata = math.meta === undefined ? "" : ` data-math-meta="${escapeHtml(math.meta)}"`;
  const value = source.length === 0 ? "" : `${source}\n`;
  return `<pre${metadata}><code class="language-math math-display">${value}</code></pre>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
