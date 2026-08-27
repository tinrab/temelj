import { InputError } from "./errors.ts";
import { formatHtml } from "./html-format.ts";
import { JsxFlowElementNode, JsxTextElementNode, type SourceSpan } from "./model.ts";
import { sameSequence } from "./utility.ts";

export { renderHtml, type HtmlRenderOptions } from "./html-lower.ts";

export type HtmlKind =
  | "comment"
  | "doctype"
  | "document"
  | "element"
  | "fragment"
  | "jsx"
  | "raw"
  | "text";

export type JsxRenderRequest = Readonly<{
  children: readonly HtmlNode[];
  kind: "complete";
  node: JsxFlowElementNode | JsxTextElementNode;
}>;

export interface HtmlFormatOptions {
  readonly closeSelfClosing?: boolean;
  readonly collapseEmptyAttributes?: boolean;
  readonly preferUnquotedAttributes?: boolean;
  readonly quote?: '"' | "'";
  readonly quoteSmart?: boolean;
  readonly rawHtml?: "escape" | "trusted";
  readonly tightSelfClosing?: boolean;
  readonly voidElements?: readonly string[];
}

export type HtmlAttributeList = readonly (number | string)[];
export type HtmlAttributeValue = boolean | number | string | HtmlAttributeList;
export type MathRenderStyle = "display" | "inline";

export interface MathRenderInput {
  readonly meta?: string;
  readonly source: string;
  readonly style: MathRenderStyle;
}

export interface CodeBlockRenderInput {
  readonly code: string;
  readonly language: string;
  readonly meta?: string;
}

export interface FootnoteReferenceRenderInput {
  readonly identifier: string;
  readonly occurrence: number;
  readonly ordinal: number;
}

export interface FootnoteSectionRenderInput {
  readonly identifiers: readonly string[];
}

abstract class HtmlNodeBase<TKind extends HtmlKind = HtmlKind> {
  public abstract readonly kind: TKind;
  public readonly origin: Readonly<SourceSpan> | undefined;
  protected constructor(origin?: SourceSpan) {
    this.origin = origin === undefined ? undefined : Object.freeze({ ...origin });
  }
  public abstract toString(): string;
  public toHtml(this: HtmlNode, options: HtmlFormatOptions = {}): string {
    return formatHtml(this, options);
  }
}

abstract class HtmlParentNode<TKind extends HtmlKind> extends HtmlNodeBase<TKind> {
  public readonly children: readonly HtmlNode[];

  protected constructor(children: readonly HtmlNode[], origin?: SourceSpan) {
    super(origin);
    this.children = Object.freeze([...children]);
  }

  public toString(): string {
    return this.children.map((child) => child.toString()).join("");
  }
}

export class HtmlTextNode extends HtmlNodeBase<"text"> {
  public readonly kind = "text";
  public readonly value: string;

  public constructor(value: string, origin?: SourceSpan) {
    super(origin);
    this.value = value;
    Object.freeze(this);
  }

  public toString(): string {
    return this.value;
  }
}

/** A JSX render instruction with its source fallback and lowered children. */
export class HtmlJsxNode extends HtmlNodeBase<"jsx"> {
  public readonly kind = "jsx";
  public readonly request: JsxRenderRequest;
  public readonly value: string;

  public constructor(value: string, request: JsxRenderRequest, origin?: SourceSpan) {
    super(origin);
    this.value = value;
    this.request = Object.freeze({ ...request, children: Object.freeze([...request.children]) });
    Object.freeze(this);
  }

  public toString(): string {
    return this.value;
  }
}

export class HtmlRawNode extends HtmlNodeBase<"raw"> {
  public readonly kind = "raw";
  public readonly value: string;

  public constructor(value: string, origin?: SourceSpan) {
    super(origin);
    this.value = value;
    Object.freeze(this);
  }

  public toString(): string {
    return this.value;
  }
}

export class HtmlCommentNode extends HtmlNodeBase<"comment"> {
  public readonly kind = "comment";
  public readonly value: string;

  public constructor(value: string, origin?: SourceSpan) {
    super(origin);
    this.value = value;
    Object.freeze(this);
  }

  public toString(): string {
    return "";
  }
}

export class HtmlDoctypeNode extends HtmlNodeBase<"doctype"> {
  public readonly kind = "doctype";

  public constructor(origin?: SourceSpan) {
    super(origin);
    Object.freeze(this);
  }

  public toString(): string {
    return "";
  }
}

export class HtmlFragmentNode extends HtmlParentNode<"fragment"> {
  public readonly kind = "fragment";

  public constructor(children: readonly HtmlNode[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }

  public with(changes: Readonly<{ children?: readonly HtmlNode[] }>): HtmlFragmentNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new HtmlFragmentNode(changes.children, this.origin);
  }
}

export class HtmlElementNode extends HtmlParentNode<"element"> {
  public readonly kind = "element";
  public readonly attributes: Readonly<Record<string, HtmlAttributeValue>>;
  public readonly classNames: readonly string[];
  public readonly tagName: string;

  public constructor(
    tagName: string,
    attributes: Readonly<Record<string, HtmlAttributeValue>> = {},
    children: readonly HtmlNode[] = [],
    origin?: SourceSpan,
  ) {
    super(children, origin);
    if (!/^[A-Za-z][A-Za-z0-9:-]*$/u.test(tagName)) {
      InputError.invalidHtmlTagName(tagName);
    }
    this.tagName = tagName;
    this.attributes = ownAttributes(attributes);
    const value = this.attributes.class;
    const classNames =
      typeof value === "string"
        ? value.split(/\s+/u).filter((item) => item.length > 0)
        : Array.isArray(value)
          ? value.filter((item) => typeof item === "string")
          : [];
    this.classNames = Object.freeze(classNames);
    if (new.target === HtmlElementNode) {
      Object.freeze(this);
    }
  }

  public hasClass(name: string): boolean {
    return this.classNames.includes(name);
  }

  public with(
    changes: Readonly<{
      tagName?: string;
      attributes?: Readonly<Record<string, HtmlAttributeValue>>;
      children?: readonly HtmlNode[];
    }>,
  ): HtmlElementNode {
    const tagName = changes.tagName ?? this.tagName;
    const attributes = changes.attributes ?? this.attributes;
    const children = changes.children ?? this.children;
    return tagName === this.tagName &&
      sameHtmlAttributes(attributes, this.attributes) &&
      sameSequence(this.children, children)
      ? this
      : new HtmlElementNode(tagName, attributes, children, this.origin);
  }
}

/** An HTML math fallback that retains the source-level render request. */
export class HtmlMathNode extends HtmlElementNode {
  public readonly math: MathRenderInput;

  public constructor(math: MathRenderInput, origin?: SourceSpan) {
    const value =
      math.style === "display" && math.source.length > 0 ? `${math.source}\n` : math.source;
    super(
      math.style === "display" ? "pre" : "code",
      math.style === "display"
        ? math.meta === undefined
          ? {}
          : { "data-math-meta": math.meta }
        : { class: ["language-math", "math-inline"] },
      math.style === "display"
        ? [
            new HtmlElementNode("code", { class: ["language-math", "math-display"] }, [
              new HtmlTextNode(value),
            ]),
          ]
        : [new HtmlTextNode(value)],
      origin,
    );
    this.math = Object.freeze({ ...math });
    Object.freeze(this);
  }
}

/** A fenced-code fallback that retains highlighting inputs. */
export class HtmlCodeBlockNode extends HtmlElementNode {
  public readonly codeBlock: CodeBlockRenderInput;

  public constructor(codeBlock: CodeBlockRenderInput, origin?: SourceSpan) {
    const value = codeBlock.code.length === 0 ? "" : `${codeBlock.code}\n`;
    super(
      "pre",
      {},
      [
        new HtmlElementNode("code", { class: [`language-${codeBlock.language}`] }, [
          new HtmlTextNode(value),
        ]),
      ],
      origin,
    );
    this.codeBlock = Object.freeze({ ...codeBlock });
    Object.freeze(this);
  }
}

/** A footnote reference that retains its document-wide streaming identity. */
export class HtmlFootnoteReferenceNode extends HtmlElementNode {
  public readonly footnoteReference: FootnoteReferenceRenderInput;

  public constructor(
    footnoteReference: FootnoteReferenceRenderInput,
    children: readonly HtmlNode[],
    origin?: SourceSpan,
  ) {
    super("sup", {}, children, origin);
    this.footnoteReference = Object.freeze({ ...footnoteReference });
    Object.freeze(this);
  }
}

/** A generated footnote section that remains provisional until document completion. */
export class HtmlFootnoteSectionNode extends HtmlElementNode {
  public readonly footnoteSection: FootnoteSectionRenderInput;

  public constructor(
    footnoteSection: FootnoteSectionRenderInput,
    children: readonly HtmlNode[],
    origin?: SourceSpan,
  ) {
    super("section", { "data-footnotes": "", class: ["footnotes"] }, children, origin);
    this.footnoteSection = Object.freeze({
      identifiers: Object.freeze([...footnoteSection.identifiers]),
    });
    Object.freeze(this);
  }
}

export class HtmlDocumentNode extends HtmlParentNode<"document"> {
  public readonly kind = "document";

  public constructor(children: readonly HtmlNode[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }

  public with(changes: Readonly<{ children?: readonly HtmlNode[] }>): HtmlDocumentNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new HtmlDocumentNode(changes.children, this.origin);
  }
}

export type HtmlNode =
  | HtmlCommentNode
  | HtmlDoctypeNode
  | HtmlDocumentNode
  | HtmlElementNode
  | HtmlFragmentNode
  | HtmlJsxNode
  | HtmlRawNode
  | HtmlTextNode;

export function isHtmlNode(value: HtmlNode | readonly HtmlNode[]): value is HtmlNode {
  return value instanceof HtmlNodeBase;
}

function ownAttributes(
  attributes: Readonly<Record<string, HtmlAttributeValue>>,
): Readonly<Record<string, HtmlAttributeValue>> {
  const result: Record<string, HtmlAttributeValue> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (!/^[A-Za-z_:][A-Za-z0-9:._-]*$/u.test(name)) {
      InputError.invalidHtmlAttributeName(name);
    }
    result[name] = isHtmlAttributeList(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(result);
}

function sameHtmlAttributes(
  left: Readonly<Record<string, HtmlAttributeValue>>,
  right: Readonly<Record<string, HtmlAttributeValue>>,
): boolean {
  if (left === right) {
    return true;
  }
  const leftEntries = Object.entries(left);
  const rightNames = Object.keys(right);
  return (
    leftEntries.length === rightNames.length &&
    leftEntries.every(([name, value]) => {
      const other = right[name];
      return Array.isArray(value) && Array.isArray(other)
        ? sameSequence(value, other)
        : value === other;
    })
  );
}

export function isHtmlAttributeList(value: HtmlAttributeValue): value is HtmlAttributeList {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" || typeof item === "number")
  );
}
