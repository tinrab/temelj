import type { SourceRange } from "../ranges.ts";
import type { MathFormat } from "../syntax-options.ts";

interface InlineSyntaxBase {
  readonly range: SourceRange;
}

export interface TextSyntax extends InlineSyntaxBase {
  readonly kind: "text";
  readonly value: string;
}

export interface InlineParentSyntax extends InlineSyntaxBase {
  readonly kind: "emphasis" | "strong" | "delete";
  readonly children: readonly InlineSyntax[];
}

export interface CodeSpanSyntax extends InlineSyntaxBase {
  readonly kind: "code";
  readonly value: string;
}

export interface HardBreakSyntax extends InlineSyntaxBase {
  readonly kind: "hardBreak";
}

export interface LinkSyntax extends InlineSyntaxBase {
  readonly kind: "link";
  readonly destination: string;
  readonly title: string | undefined;
  readonly children: readonly InlineSyntax[];
}

export interface ImageSyntax extends InlineSyntaxBase {
  readonly kind: "image";
  readonly destination: string;
  readonly title: string | undefined;
  readonly alt: string;
}

export interface ReferenceSyntax extends InlineSyntaxBase {
  readonly kind: "reference";
  readonly identifier: string;
  readonly referenceKind: "full" | "collapsed" | "shortcut";
  readonly image: boolean;
  readonly children: readonly InlineSyntax[];
}

interface ValuedInlineSyntax extends InlineSyntaxBase {
  readonly value: string;
}

export interface RawHtmlSyntax extends ValuedInlineSyntax {
  readonly kind: "rawHtml";
}

export interface ExpressionSyntax extends ValuedInlineSyntax {
  readonly kind: "expression";
}

export interface JsxSyntax extends ValuedInlineSyntax {
  readonly kind: "jsx";
}

export interface InlineMathSyntax extends ValuedInlineSyntax {
  readonly kind: "math";
  readonly format: MathFormat;
}

export interface FootnoteReferenceSyntax extends InlineSyntaxBase {
  readonly kind: "footnoteReference";
  readonly identifier: string;
}

export interface InlineDirectiveAttribute {
  readonly name: string;
  readonly value: string;
}

export interface InlineDirectiveSyntax extends InlineSyntaxBase {
  readonly kind: "directive";
  readonly name: string;
  readonly label: readonly InlineSyntax[];
  readonly attributes: readonly InlineDirectiveAttribute[];
}

export type InlineSyntax =
  | TextSyntax
  | InlineParentSyntax
  | CodeSpanSyntax
  | HardBreakSyntax
  | LinkSyntax
  | ImageSyntax
  | ReferenceSyntax
  | RawHtmlSyntax
  | ExpressionSyntax
  | JsxSyntax
  | InlineMathSyntax
  | FootnoteReferenceSyntax
  | InlineDirectiveSyntax;

export interface InvalidInlineSyntax {
  readonly range: SourceRange;
  readonly syntax: "expression" | "jsx";
}

export interface InlineParseResult {
  readonly nodes: readonly InlineSyntax[];
  readonly invalid: readonly InvalidInlineSyntax[];
  readonly references: ReadonlySet<string>;
  readonly footnotes: ReadonlySet<string>;
  readonly pending?: InlinePendingSyntax;
}

export interface PendingInlineParentSyntax extends InlineSyntaxBase {
  readonly kind: "strong" | "emphasis" | "delete";
  readonly children: readonly InlineSyntax[];
}

export interface PendingCodeSyntax extends InlineSyntaxBase {
  readonly kind: "code";
  readonly value: string;
}

export interface PendingLinkSyntax extends InlineSyntaxBase {
  readonly kind: "link";
  readonly children: readonly InlineSyntax[];
}

export interface PendingImageSyntax extends InlineSyntaxBase {
  readonly kind: "image";
  readonly alt: string;
}

export interface PendingMathSyntax extends InlineSyntaxBase {
  readonly kind: "math";
  readonly value: string;
  readonly format: MathFormat;
}

export type InlinePendingSyntax =
  | PendingInlineParentSyntax
  | PendingCodeSyntax
  | PendingLinkSyntax
  | PendingImageSyntax
  | PendingMathSyntax;
