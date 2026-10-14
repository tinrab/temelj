export {
  compile,
  type CompileArtifact,
  type CompileLimit,
  type CompileOptions,
  type CompileOutcome,
  type CompileOutputFormat,
  type CompileSchemaOptions,
  type FunctionBodyCompileArtifact,
  type MdxTransportValue,
  type ProgramCompileArtifact,
} from "./compiler.ts";

export {
  formatDiagnostic,
  hasErrorDiagnostics,
  type Diagnostic,
  type DiagnosticFormatOptions,
  type DiagnosticReporter,
  type DiagnosticSeverity,
  type RelatedInformation,
} from "./diagnostics.ts";

export {
  CompileError,
  ConfigurationError,
  InputError,
  MdxError,
  TransformError,
  type CompilationInvariant,
  type CompilationIssue,
  type ConfigurationIssue,
  type InputIssue,
  type TransformIssue,
  type TransformTarget,
} from "./errors.ts";

export { formatMdx, type FormatOptions } from "./format.ts";

export type { HeadingDepth } from "./heading.ts";

export { formatHtml, type HtmlFormatOptions } from "./html-format.ts";

export { lowerHtml, type HtmlRenderOptions } from "./html-lower.ts";

export {
  htmlChildren,
  htmlClassNames,
  htmlFallback,
  htmlText,
  isHtmlAttributeList,
  type HtmlAttributeList,
  type HtmlAttributes,
  type HtmlAttributeValue,
  type HtmlCodeBlockNode,
  type HtmlCommentNode,
  type HtmlDoctypeNode,
  type HtmlElementNode,
  type HtmlExpressionNode,
  type HtmlFootnoteReferenceNode,
  type HtmlFootnoteSectionNode,
  type HtmlJsxNode,
  type HtmlKind,
  type HtmlMathNode,
  type HtmlNode,
  type HtmlNodeForKind,
  type HtmlRawNode,
  type HtmlRootNode,
  type HtmlSemanticNode,
  type HtmlTextNode,
  type MathRenderStyle,
} from "./html.ts";

export { normalizeIdentifier } from "./identifier.ts";

export {
  documentFrontmatter,
  FrontmatterTemporal,
  indexDocument,
  mdxChildren,
  nodeText,
  type BlockExpressionNode,
  type BlockQuoteNode,
  type CodeBlockNode,
  type ContainerDirectiveNode,
  type DefinitionNode,
  type DeleteNode,
  type DirectiveAttribute,
  type DirectiveLabelNode,
  type DisplayMathNode,
  type DocumentIndex,
  type DocumentNode,
  type EmphasisNode,
  type EsmNode,
  type FlowContent,
  type FootnoteDefinitionNode,
  type FootnoteReferenceNode,
  type FrontmatterNode,
  type FrontmatterObject,
  type FrontmatterTemporalKind,
  type FrontmatterValue,
  type HardBreakNode,
  type HeadingNode,
  type ImageNode,
  type ImageReferenceNode,
  type InlineCodeNode,
  type InlineExpressionNode,
  type InlineMathNode,
  type JsxAttribute,
  type JsxAttributeLike,
  type JsxAttributeValue,
  type JsxAttributeValueExpression,
  type JsxFlowElementNode,
  type JsxSpreadAttribute,
  type JsxTextElementNode,
  type LeafDirectiveNode,
  type LinkNode,
  type LinkReferenceNode,
  type ListItemNode,
  type ListNode,
  type MdxKind,
  type MdxNode,
  type MdxNodeForKind,
  type ParagraphNode,
  type PhrasingContent,
  type RawHtmlBlockNode,
  type RawHtmlInlineNode,
  type ReferenceKind,
  type SourceRange,
  type StrongNode,
  type TableAlignment,
  type TableCellNode,
  type TableNode,
  type TableRowNode,
  type TextDirectiveNode,
  type TextNode,
  type ThematicBreakNode,
} from "./model.ts";

export {
  defaultParserLimits,
  parse,
  type MdxFailure,
  type ParseOptions,
  type ParseOutcome,
  type ParserLimit,
  type ParserLimits,
} from "./parser.ts";

export {
  Processor,
  type ProcessInput,
  type ProcessOptions,
  type ProcessOutcome,
  type ProcessorOptions,
} from "./processor.ts";

export type { SourceMap } from "./source-map.ts";

export {
  SourceFile,
  type SourceFileInput,
  type SourceLocation,
  type SourceSpan,
} from "./source.ts";

export {
  MdxStream,
  type BlockId,
  type CompletedBlockSnapshot,
  type MdxEdit,
  type MdxStreamCompletion,
  type MdxStreamOptions,
  type MdxStreamSnapshot,
  type StreamDependencies,
  type StreamingBlockSnapshot,
} from "./stream.ts";

export {
  renderStreamingHtml,
  type StreamingCodeBlock,
  type StreamingDocument,
  type StreamingElement,
  type StreamingFootnoteReference,
  type StreamingFootnoteSection,
  type StreamingJsx,
  type StreamingMath,
  type StreamingNode,
  type StreamingOmitted,
  type StreamingPendingCode,
  type StreamingPendingDelete,
  type StreamingPendingEmphasis,
  type StreamingPendingEsm,
  type StreamingPendingExpression,
  type StreamingPendingFencedCode,
  type StreamingPendingImage,
  type StreamingPendingLink,
  type StreamingPendingMarkdownNode,
  type StreamingPendingMath,
  type StreamingPendingStrong,
  type StreamingRaw,
  type StreamingText,
  type StreamingUnresolvedFootnoteReference,
  type StreamingUnresolvedImageReference,
  type StreamingUnresolvedLinkReference,
} from "./streaming-document.ts";

export type {
  FrontmatterFormat,
  FrontmatterMode,
  MathFormat,
  MathMode,
  SyntaxOptions,
} from "./syntax-options.ts";

export {
  rewriteHtml,
  rewriteMdx,
  selectHtml,
  selectMdx,
  TreeCursor,
  walkHtml,
  walkMdx,
  type HtmlRewriteHandlers,
  type MdxRewriteHandlers,
} from "./traversal.ts";
