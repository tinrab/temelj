import type { SourceRange } from "../ranges.ts";
import type { FrontmatterFormat, MathFormat } from "../syntax-options.ts";
import type { InlineSegment } from "./inline-input.ts";

interface ContainerFrameBase {
  readonly marker: SourceRange;
  readonly children: readonly BlockSyntax[];
  readonly end: number;
}

export interface BlockQuoteFrame extends ContainerFrameBase {
  readonly kind: "blockQuote";
  readonly contentIndent: number;
  readonly start: number;
}

export interface ListItemFrame extends ContainerFrameBase {
  readonly kind: "listItem";
  readonly markerCharacter: "." | ")" | "*" | "+" | "-";
  readonly contentIndent: number;
  readonly ordered: boolean;
  readonly start: number | undefined;
  readonly checked: boolean | undefined;
  readonly spread: boolean;
  readonly rangeStart: number;
}

export interface DirectiveContainerFrame extends ContainerFrameBase {
  readonly kind: "directiveContainer";
  readonly name: string;
  readonly fenceLength: number;
  readonly start: number;
  readonly label: readonly InlineSegment[] | undefined;
  readonly attributes: readonly DirectiveAttributeSyntax[];
}

export interface FootnoteDefinitionFrame extends ContainerFrameBase {
  readonly kind: "footnoteDefinition";
  readonly identifier: string;
  readonly contentIndent: number;
  readonly start: number;
}

export type ContainerFrame =
  | BlockQuoteFrame
  | ListItemFrame
  | DirectiveContainerFrame
  | FootnoteDefinitionFrame;

interface OpenLeafBase {
  readonly start: number;
  readonly end: number;
}

export interface OpenParagraph extends OpenLeafBase {
  readonly kind: "paragraph";
  readonly lines: readonly InlineSegment[];
  readonly pendingEnding: SourceRange;
}

export interface OpenFencedCode extends OpenLeafBase {
  readonly kind: "fencedCode";
  readonly value: readonly InlineSegment[];
  readonly marker: "`" | "~";
  readonly fenceLength: number;
  readonly language: SourceRange | undefined;
  readonly meta: SourceRange | undefined;
}

export interface OpenIndentedCode extends OpenLeafBase {
  readonly kind: "indentedCode";
  readonly value: readonly InlineSegment[];
  readonly pendingBlank: readonly InlineSegment[];
}

export interface OpenHtml extends OpenLeafBase {
  readonly kind: "html";
  readonly closing: "-->" | ">" | "?>" | "]]>";
}

export interface OpenFrontmatter extends OpenLeafBase {
  readonly kind: "frontmatter";
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly format: FrontmatterFormat;
  readonly fence: "---" | "+++";
}

export interface OpenMath extends OpenLeafBase {
  readonly kind: "math";
  readonly value: readonly InlineSegment[];
  readonly format: MathFormat;
  readonly fence: "dollar" | "tex";
  readonly fenceLength: number;
  readonly meta: SourceRange | undefined;
}

interface OpenEmbeddedLeaf extends OpenLeafBase {
  readonly value: readonly InlineSegment[];
}

export interface OpenJsx extends OpenEmbeddedLeaf {
  readonly kind: "jsx";
}

export interface OpenExpression extends OpenEmbeddedLeaf {
  readonly kind: "expression";
}

export interface OpenEsm extends OpenEmbeddedLeaf {
  readonly kind: "esm";
}

export interface OpenTable extends OpenLeafBase {
  readonly kind: "table";
  readonly alignments: readonly TableAlignmentSyntax[];
  readonly rows: readonly TableRowSyntax[];
}

export type OpenLeaf =
  | OpenParagraph
  | OpenFencedCode
  | OpenIndentedCode
  | OpenHtml
  | OpenFrontmatter
  | OpenMath
  | OpenJsx
  | OpenExpression
  | OpenEsm
  | OpenTable;

interface BlockSyntaxBase {
  readonly range: SourceRange;
}

export interface ParagraphSyntax extends BlockSyntaxBase {
  readonly kind: "paragraph";
  readonly input: readonly InlineSegment[];
}

export interface HeadingSyntax extends BlockSyntaxBase {
  readonly kind: "heading";
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly input: readonly InlineSegment[];
}

export interface CodeSyntax extends BlockSyntaxBase {
  readonly kind: "code";
  readonly value: readonly InlineSegment[];
  readonly fenced: boolean;
  readonly language: SourceRange | undefined;
  readonly meta: SourceRange | undefined;
}

export interface ThematicBreakSyntax extends BlockSyntaxBase {
  readonly kind: "thematicBreak";
}

export interface BlockQuoteSyntax extends BlockSyntaxBase {
  readonly kind: "blockQuote";
  readonly children: readonly BlockSyntax[];
}

export interface ListSyntax extends BlockSyntaxBase {
  readonly kind: "list";
  readonly ordered: boolean;
  readonly start: number | undefined;
  readonly spread: boolean;
  readonly marker: "." | ")" | "*" | "+" | "-";
  readonly items: readonly ListItemSyntax[];
}

export interface DefinitionSyntax extends BlockSyntaxBase {
  readonly kind: "definition";
  readonly identifier: string;
  readonly destination: SourceRange;
  readonly title: SourceRange | undefined;
}

export interface FootnoteDefinitionSyntax extends BlockSyntaxBase {
  readonly kind: "footnoteDefinition";
  readonly identifier: string;
  readonly children: readonly BlockSyntax[];
}

export interface RawHtmlSyntax extends BlockSyntaxBase {
  readonly kind: "rawHtml";
}

export interface FrontmatterSyntax extends BlockSyntaxBase {
  readonly kind: "frontmatter";
  readonly value: SourceRange;
  readonly format: FrontmatterFormat;
}

export interface DirectiveSyntax extends BlockSyntaxBase {
  readonly kind: "directive";
  readonly name: string;
  readonly label: readonly InlineSegment[] | undefined;
  readonly attributes: readonly DirectiveAttributeSyntax[];
  readonly children: readonly BlockSyntax[];
}

export interface LeafDirectiveSyntax extends BlockSyntaxBase {
  readonly kind: "leafDirective";
  readonly name: string;
  readonly label: readonly InlineSegment[] | undefined;
  readonly attributes: readonly DirectiveAttributeSyntax[];
}

export interface MathSyntax extends BlockSyntaxBase {
  readonly kind: "math";
  readonly value: readonly InlineSegment[];
  readonly format: MathFormat;
  readonly meta: SourceRange | undefined;
}

export interface TableSyntax extends BlockSyntaxBase {
  readonly kind: "table";
  readonly alignments: readonly TableAlignmentSyntax[];
  readonly rows: readonly TableRowSyntax[];
}

export interface JsxSyntax extends BlockSyntaxBase {
  readonly kind: "jsx";
}

export interface ExpressionSyntax extends BlockSyntaxBase {
  readonly kind: "expression";
}

export interface EsmSyntax extends BlockSyntaxBase {
  readonly kind: "esm";
}

export interface InvalidMdxSyntax extends BlockSyntaxBase {
  readonly kind: "invalidMdx";
  readonly syntax: "jsx" | "expression" | "esm";
  readonly state: "incomplete" | "invalid";
}

export type BlockSyntax =
  | ParagraphSyntax
  | HeadingSyntax
  | CodeSyntax
  | ThematicBreakSyntax
  | BlockQuoteSyntax
  | ListSyntax
  | DefinitionSyntax
  | FootnoteDefinitionSyntax
  | RawHtmlSyntax
  | FrontmatterSyntax
  | DirectiveSyntax
  | LeafDirectiveSyntax
  | MathSyntax
  | TableSyntax
  | JsxSyntax
  | ExpressionSyntax
  | EsmSyntax
  | InvalidMdxSyntax;

export interface ListItemSyntax {
  readonly range: SourceRange;
  readonly checked: boolean | undefined;
  readonly spread: boolean;
  readonly children: readonly BlockSyntax[];
}

export interface TableRowSyntax {
  readonly range: SourceRange;
  readonly cells: readonly (readonly InlineSegment[])[];
}

export type TableAlignmentSyntax = "center" | "left" | "none" | "right";

export interface DirectiveAttributeSyntax {
  readonly name: string;
  readonly value: string;
}

export type PendingParagraphSyntax = ParagraphSyntax;

export interface PendingFencedCodeSyntax extends BlockSyntaxBase {
  readonly kind: "fencedCode";
  readonly value: readonly InlineSegment[];
  readonly language: SourceRange | undefined;
}

export interface PendingMathSyntax extends BlockSyntaxBase {
  readonly kind: "math";
  readonly value: readonly InlineSegment[];
  readonly format: MathFormat;
}

export interface PendingJsxSyntax extends BlockSyntaxBase {
  readonly kind: "jsx";
}

export interface PendingExpressionSyntax extends BlockSyntaxBase {
  readonly kind: "expression";
}

export interface PendingEsmSyntax extends BlockSyntaxBase {
  readonly kind: "esm";
}

export type PendingBlockSyntax =
  | PendingParagraphSyntax
  | PendingFencedCodeSyntax
  | PendingMathSyntax
  | PendingJsxSyntax
  | PendingExpressionSyntax
  | PendingEsmSyntax;
