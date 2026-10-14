import { isNumber, isString } from "@temelj/value";

import type { JsxFlowElementNode, JsxTextElementNode, SourceRange } from "./model.ts";

/**
 * Lowered HTML is plain, readonly data. Semantic kinds such as `codeBlock` and
 * `math` keep their inputs so a renderer or plugin can replace them; their
 * default presentation comes from `htmlFallback`.
 */
interface HtmlNodeBase<TKind extends string> {
  readonly kind: TKind;
  readonly origin?: SourceRange;
}

export type HtmlAttributeList = readonly (number | string)[];

export type HtmlAttributeValue = boolean | number | string | HtmlAttributeList;

export type HtmlAttributes = Readonly<Record<string, HtmlAttributeValue>>;

export interface HtmlTextNode extends HtmlNodeBase<"text"> {
  readonly value: string;
}

/** Authored raw HTML. `formatHtml` escapes it unless raw HTML is trusted. */
export interface HtmlRawNode extends HtmlNodeBase<"raw"> {
  readonly value: string;
}

export interface HtmlCommentNode extends HtmlNodeBase<"comment"> {
  readonly value: string;
}

export type HtmlDoctypeNode = HtmlNodeBase<"doctype">;

export interface HtmlElementNode extends HtmlNodeBase<"element"> {
  readonly tagName: string;
  readonly attributes: HtmlAttributes;
  readonly children: readonly HtmlNode[];
}

export interface HtmlRootNode extends HtmlNodeBase<"root"> {
  readonly children: readonly HtmlNode[];
}

/** A JavaScript expression that only a compiler evaluates. `fallback` is the authored source. */
export interface HtmlExpressionNode extends HtmlNodeBase<"expression"> {
  readonly code: string;
  readonly fallback: string;
}

/** A JSX element that a renderer may resolve. `fallback` is the authored source. */
export interface HtmlJsxNode extends HtmlNodeBase<"jsx"> {
  readonly node: JsxFlowElementNode | JsxTextElementNode;
  readonly fallback: string;
  readonly children: readonly HtmlNode[];
}

export interface HtmlCodeBlockNode extends HtmlNodeBase<"codeBlock"> {
  readonly code: string;
  readonly language: string;
  readonly meta?: string;
}

export type MathRenderStyle = "display" | "inline";

export interface HtmlMathNode extends HtmlNodeBase<"math"> {
  readonly source: string;
  readonly style: MathRenderStyle;
  readonly meta?: string;
}

/** A footnote reference with its document-wide numbering. Children are the `sup` content. */
export interface HtmlFootnoteReferenceNode extends HtmlNodeBase<"footnoteReference"> {
  readonly identifier: string;
  readonly occurrence: number;
  readonly ordinal: number;
  readonly children: readonly HtmlNode[];
}

/** The generated footnote section. Children are the `section` content. */
export interface HtmlFootnoteSectionNode extends HtmlNodeBase<"footnoteSection"> {
  readonly identifiers: readonly string[];
  readonly children: readonly HtmlNode[];
}

export type HtmlNode =
  | HtmlCodeBlockNode
  | HtmlCommentNode
  | HtmlDoctypeNode
  | HtmlElementNode
  | HtmlExpressionNode
  | HtmlFootnoteReferenceNode
  | HtmlFootnoteSectionNode
  | HtmlJsxNode
  | HtmlMathNode
  | HtmlRawNode
  | HtmlRootNode
  | HtmlTextNode;

export type HtmlKind = HtmlNode["kind"];

export type HtmlNodeForKind<TKind extends HtmlKind> = Extract<HtmlNode, { readonly kind: TKind }>;

export type HtmlSemanticNode =
  | HtmlCodeBlockNode
  | HtmlFootnoteReferenceNode
  | HtmlFootnoteSectionNode
  | HtmlMathNode;

export function htmlChildren(node: HtmlNode): readonly HtmlNode[] {
  return "children" in node ? node.children : [];
}

/** The default element presentation of a semantic node. */
export function htmlFallback(node: HtmlSemanticNode): HtmlElementNode {
  switch (node.kind) {
    case "codeBlock":
      return element("pre", {}, [
        element("code", { class: [`language-${node.language}`] }, [
          text(node.code.length === 0 ? "" : `${node.code}\n`),
        ]),
      ]);
    case "math":
      if (node.style === "inline") {
        return element("code", { class: ["language-math", "math-inline"] }, [text(node.source)]);
      }

      return element("pre", node.meta === undefined ? {} : { "data-math-meta": node.meta }, [
        element("code", { class: ["language-math", "math-display"] }, [
          text(node.source.length === 0 ? "" : `${node.source}\n`),
        ]),
      ]);
    case "footnoteReference":
      return element("sup", {}, node.children);
    case "footnoteSection":
      return element("section", { "data-footnotes": "", class: ["footnotes"] }, node.children);
  }
}

export function isHtmlAttributeList(value: HtmlAttributeValue): value is HtmlAttributeList {
  return Array.isArray(value) && value.every((item) => isString(item) || isNumber(item));
}

/** Class names from a `class` attribute in either string or list form. */
export function htmlClassNames(node: HtmlElementNode): readonly string[] {
  const value = node.attributes.class;

  if (isString(value)) {
    return value.split(/\s+/u).filter((item) => item.length > 0);
  }

  return Array.isArray(value) ? value.filter((item) => isString(item)) : [];
}

function element(
  tagName: string,
  attributes: HtmlAttributes,
  children: readonly HtmlNode[],
): HtmlElementNode {
  return { kind: "element", tagName, attributes, children };
}

function text(value: string): HtmlTextNode {
  return { kind: "text", value };
}

/** Text content of a node, as a reader sees it. */
export function htmlText(node: HtmlNode): string {
  switch (node.kind) {
    case "text":
    case "raw":
      return node.value;
    case "jsx":
    case "expression":
      return node.fallback;
    case "codeBlock":
      return node.code;
    case "math":
      return node.source;
    default:
      return htmlChildren(node).map(htmlText).join("");
  }
}
