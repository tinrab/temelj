import type { HeadingDepth } from "./heading.ts";
import type { SourceRange } from "./ranges.ts";
import type { FrontmatterFormat, MathFormat } from "./syntax-options.ts";

import { normalizeIdentifier } from "./identifier.ts";

export type { SourceRange } from "./ranges.ts";

/**
 * Semantic MDX nodes are plain, readonly data. `origin` is a UTF-16 range in the
 * `SourceFile` owned by the outcome that produced the tree.
 */
interface NodeBase<TKind extends string> {
  readonly kind: TKind;
  readonly origin?: SourceRange;
}

interface ParentBase<TKind extends string, TChild> extends NodeBase<TKind> {
  readonly children: readonly TChild[];
}

export interface TextNode extends NodeBase<"text"> {
  readonly value: string;
}

export type EmphasisNode = ParentBase<"emphasis", PhrasingContent>;

export type StrongNode = ParentBase<"strong", PhrasingContent>;

export type DeleteNode = ParentBase<"delete", PhrasingContent>;

export interface InlineCodeNode extends NodeBase<"inlineCode"> {
  readonly value: string;
}

export type HardBreakNode = NodeBase<"hardBreak">;

export interface LinkNode extends ParentBase<"link", PhrasingContent> {
  readonly url: string;
  readonly title?: string;
}

export interface ImageNode extends NodeBase<"image"> {
  readonly url: string;
  readonly alt: string;
  readonly title?: string;
}

export type ReferenceKind = "full" | "collapsed" | "shortcut";

export interface LinkReferenceNode extends ParentBase<"linkReference", PhrasingContent> {
  /** Normalized with `normalizeIdentifier`. */
  readonly identifier: string;
  readonly referenceKind: ReferenceKind;
}

export interface ImageReferenceNode extends NodeBase<"imageReference"> {
  /** Normalized with `normalizeIdentifier`. */
  readonly identifier: string;
  readonly alt: string;
  readonly referenceKind: ReferenceKind;
}

export interface RawHtmlInlineNode extends NodeBase<"rawHtmlInline"> {
  readonly value: string;
}

export interface FootnoteReferenceNode extends NodeBase<"footnoteReference"> {
  /** Normalized with `normalizeIdentifier`. */
  readonly identifier: string;
  readonly label: string;
}

export interface DirectiveAttribute {
  readonly name: string;
  readonly value: string;
}

export type DirectiveLabelNode = ParentBase<"directiveLabel", PhrasingContent>;

interface DirectiveBase<TKind extends string> extends NodeBase<TKind> {
  readonly name: string;
  /** Attribute names are unique. */
  readonly attributes: readonly DirectiveAttribute[];
  readonly label?: DirectiveLabelNode;
}

export type TextDirectiveNode = DirectiveBase<"textDirective">;

export type LeafDirectiveNode = DirectiveBase<"leafDirective">;

export interface ContainerDirectiveNode extends DirectiveBase<"containerDirective"> {
  readonly children: readonly FlowContent[];
}

export interface InlineMathNode extends NodeBase<"inlineMath"> {
  readonly value: string;
  readonly format: MathFormat;
}

export interface DisplayMathNode extends NodeBase<"displayMath"> {
  readonly value: string;
  readonly format: MathFormat;
  /** Only dollar math can carry metadata. */
  readonly meta?: string;
}

export interface InlineExpressionNode extends NodeBase<"inlineExpression"> {
  readonly code: string;
}

export interface BlockExpressionNode extends NodeBase<"blockExpression"> {
  readonly code: string;
}

export interface EsmNode extends NodeBase<"esm"> {
  readonly code: string;
}

export interface JsxAttributeValueExpression extends NodeBase<"jsxAttributeValueExpression"> {
  readonly code: string;
}

export type JsxAttributeValue = string | JsxAttributeValueExpression;

export interface JsxAttribute extends NodeBase<"jsxAttribute"> {
  readonly name: string;
  /** An omitted value is the boolean shorthand `<A enabled />`. */
  readonly value?: JsxAttributeValue;
}

export interface JsxSpreadAttribute extends NodeBase<"jsxSpreadAttribute"> {
  /** The spread argument, without the `...` operator. */
  readonly code: string;
}

export type JsxAttributeLike = JsxAttribute | JsxSpreadAttribute;

interface JsxElementBase<TKind extends string, TChild> extends ParentBase<TKind, TChild> {
  /** `undefined` for fragments. */
  readonly name?: string;
  readonly attributes: readonly JsxAttributeLike[];
}

export type JsxTextElementNode = JsxElementBase<"jsxTextElement", PhrasingContent>;

export type JsxFlowElementNode = JsxElementBase<"jsxFlowElement", FlowContent>;

export type ParagraphNode = ParentBase<"paragraph", PhrasingContent>;

export interface HeadingNode extends ParentBase<"heading", PhrasingContent> {
  readonly depth: HeadingDepth;
}

export interface CodeBlockNode extends NodeBase<"codeBlock"> {
  readonly value: string;
  readonly language?: string;
  readonly meta?: string;
}

export type ThematicBreakNode = NodeBase<"thematicBreak">;

export type BlockQuoteNode = ParentBase<"blockquote", FlowContent>;

export interface ListItemNode extends ParentBase<"listItem", FlowContent> {
  /** `undefined` for an ordinary item, a boolean for a task item. */
  readonly checked?: boolean;
  readonly spread: boolean;
}

export interface ListNode extends ParentBase<"list", ListItemNode> {
  readonly ordered: boolean;
  readonly spread: boolean;
  readonly start: number;
}

export interface DefinitionNode extends NodeBase<"definition"> {
  /** Normalized with `normalizeIdentifier`. */
  readonly identifier: string;
  readonly url: string;
  readonly title?: string;
}

export interface FootnoteDefinitionNode extends ParentBase<"footnoteDefinition", FlowContent> {
  /** Normalized with `normalizeIdentifier`. */
  readonly identifier: string;
  readonly label: string;
}

export interface RawHtmlBlockNode extends NodeBase<"rawHtmlBlock"> {
  readonly value: string;
}

export type FrontmatterValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | FrontmatterTemporal
  | readonly FrontmatterValue[]
  | FrontmatterObject;

export interface FrontmatterObject {
  readonly [key: string]: FrontmatterValue;
}

export type FrontmatterTemporalType =
  | "offset-date-time"
  | "local-date-time"
  | "local-date"
  | "local-time";

/** A TOML date or time as an ISO 8601 string. */
export interface FrontmatterTemporal {
  readonly kind: "temporal";
  readonly type: FrontmatterTemporalType;
  readonly value: string;
}

export interface FrontmatterNode extends NodeBase<"frontmatter"> {
  readonly format: FrontmatterFormat;
  readonly value: string;
  /** Decoded data. Present when the parser decoded the authored value. */
  readonly data?: FrontmatterObject;
  /** The authored value range, excluding fences. */
  readonly valueOrigin?: SourceRange;
}

export type TableAlignment = "center" | "left" | "none" | "right";

export type TableCellNode = ParentBase<"tableCell", PhrasingContent>;

export type TableRowNode = ParentBase<"tableRow", TableCellNode>;

export interface TableNode extends ParentBase<"table", TableRowNode> {
  readonly alignments: readonly TableAlignment[];
}

export type DocumentNode = ParentBase<"document", FlowContent>;

export type PhrasingContent =
  | TextNode
  | EmphasisNode
  | StrongNode
  | DeleteNode
  | InlineCodeNode
  | HardBreakNode
  | LinkNode
  | ImageNode
  | LinkReferenceNode
  | ImageReferenceNode
  | RawHtmlInlineNode
  | FootnoteReferenceNode
  | TextDirectiveNode
  | InlineMathNode
  | JsxTextElementNode
  | InlineExpressionNode;

export type FlowContent =
  | ParagraphNode
  | HeadingNode
  | CodeBlockNode
  | ThematicBreakNode
  | BlockQuoteNode
  | ListNode
  | DefinitionNode
  | RawHtmlBlockNode
  | FootnoteDefinitionNode
  | FrontmatterNode
  | LeafDirectiveNode
  | ContainerDirectiveNode
  | DisplayMathNode
  | TableNode
  | BlockExpressionNode
  | EsmNode
  | JsxFlowElementNode;

export type MdxNode =
  | DocumentNode
  | FlowContent
  | ListItemNode
  | TableRowNode
  | TableCellNode
  | DirectiveLabelNode
  | PhrasingContent;

export type MdxKind = MdxNode["kind"];

export type MdxNodeForKind<TKind extends MdxKind> = Extract<MdxNode, { readonly kind: TKind }>;

/** Whether a node can appear where phrasing (inline) content is expected. */
export function isPhrasingContent(node: MdxNode): node is PhrasingContent {
  switch (node.kind) {
    case "text":
    case "emphasis":
    case "strong":
    case "delete":
    case "inlineCode":
    case "hardBreak":
    case "link":
    case "image":
    case "linkReference":
    case "imageReference":
    case "rawHtmlInline":
    case "footnoteReference":
    case "textDirective":
    case "inlineMath":
    case "jsxTextElement":
    case "inlineExpression":
      return true;
    default:
      return false;
  }
}

/** Whether a node can appear where flow (block) content is expected. */
export function isFlowContent(node: MdxNode): node is FlowContent {
  switch (node.kind) {
    case "paragraph":
    case "heading":
    case "codeBlock":
    case "thematicBreak":
    case "blockquote":
    case "list":
    case "definition":
    case "rawHtmlBlock":
    case "footnoteDefinition":
    case "frontmatter":
    case "leafDirective":
    case "containerDirective":
    case "displayMath":
    case "table":
    case "blockExpression":
    case "esm":
    case "jsxFlowElement":
      return true;
    default:
      return false;
  }
}

/** Child nodes in document order, including a directive label before its body. */
export function mdxChildren(node: MdxNode): readonly MdxNode[] {
  switch (node.kind) {
    case "textDirective":
    case "leafDirective":
      return node.label === undefined ? [] : [node.label];
    case "containerDirective":
      return node.label === undefined ? node.children : [node.label, ...node.children];
    default:
      return "children" in node ? node.children : [];
  }
}

/** Semantic text content: what a reader sees, without markup. */
export function nodeText(node: MdxNode): string {
  switch (node.kind) {
    case "text":
    case "inlineCode":
    case "inlineMath":
    case "displayMath":
    case "codeBlock":
    case "rawHtmlInline":
    case "rawHtmlBlock":
      return node.value;
    case "image":
    case "imageReference":
      return node.alt;
    case "hardBreak":
      return "\n";
    case "inlineExpression":
    case "blockExpression":
    case "esm":
    case "definition":
    case "frontmatter":
    case "footnoteReference":
    case "thematicBreak":
      return "";
    case "document":
    case "jsxFlowElement":
      return node.children.map(nodeText).join("\n\n");
    case "list":
    case "table":
      return node.children.map(nodeText).join("\n");
    case "tableRow":
      return node.children.map(nodeText).join("\t");
    default:
      return mdxChildren(node).map(nodeText).join("");
  }
}

export interface DocumentIndex {
  readonly definitions: ReadonlyMap<string, DefinitionNode>;
  readonly footnotes: ReadonlyMap<string, FootnoteDefinitionNode>;
}

/** Indexes the first definition and footnote for each normalized identifier. */
export function indexDocument(document: DocumentNode): DocumentIndex {
  const definitions = new Map<string, DefinitionNode>();
  const footnotes = new Map<string, FootnoteDefinitionNode>();
  const pending: MdxNode[] = [...document.children].reverse();

  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.kind === "definition") {
      const identifier = normalizeIdentifier(node.identifier);

      if (!definitions.has(identifier)) {
        definitions.set(identifier, node);
      }
    } else if (node.kind === "footnoteDefinition") {
      const identifier = normalizeIdentifier(node.identifier);

      if (!footnotes.has(identifier)) {
        footnotes.set(identifier, node);
      }
    }

    const children = mdxChildren(node);

    for (let index = children.length - 1; index >= 0; index--) {
      pending.push(children[index]);
    }
  }

  return { definitions, footnotes };
}

export function documentFrontmatter(document: DocumentNode): FrontmatterNode | undefined {
  const first = document.children[0];

  return first?.kind === "frontmatter" ? first : undefined;
}
