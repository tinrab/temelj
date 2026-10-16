export {
  compile,
  type CompileArtifact,
  type CompileOptions,
  type CompileResult,
  type CompileOutputFormat,
  type CompileSchemaOptions,
  type FunctionBodyCompileArtifact,
  type CompiledComponents,
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
  ParseError,
  LimitError,
  FrontmatterError,
  type CompileLimit,
  type FrontmatterIssue,
  TransformError,
  type CompilationInvariant,
  type CompilationIssue,
  type ConfigurationIssue,
  type InputIssue,
  type TransformIssue,
  type TransformTarget,
} from "./errors.ts";

export type { FormatOptions } from "./format-context.ts";

export { formatMdx } from "./format.ts";

export type { HeadingDepth } from "./heading.ts";

export { formatHtml, type HtmlFormatOptions } from "./html-format.ts";

export { HtmlStreamRenderer } from "./html-stream.ts";

export { lowerHtml, type HtmlRenderOptions } from "./html-lower.ts";

export {
  htmlChildren,
  htmlClassNames,
  htmlFallback,
  htmlText,
  isHtmlAttributeList,
  pendingFallback,
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
  type HtmlPendingConstruct,
  type HtmlPendingNode,
  type HtmlRawNode,
  type HtmlRootNode,
  type HtmlSemanticNode,
  type HtmlTextNode,
  type HtmlUnresolvedReferenceNode,
  type MathRenderStyle,
} from "./html.ts";

export { normalizeIdentifier } from "./identifier.ts";

export {
  documentFrontmatter,
  indexDocument,
  isFlowContent,
  isPhrasingContent,
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
  type FrontmatterTemporal,
  type FrontmatterTemporalType,
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
  type ParseOptions,
  type ParseResult,
  type ParserLimit,
  type ParserLimits,
} from "./parser.ts";

export {
  Processor,
  type ProcessInput,
  type ProcessOptions,
  type ProcessResult,
  type ProcessorOptions,
} from "./processor.ts";

export type { SourceMap } from "./source-map.ts";

export {
  SourceBuffer,
  SourceFile,
  type SourceFileInput,
  type SourceLocation,
  type SourceSpan,
} from "./source.ts";

export {
  applyBlockEvent,
  blockEvent,
  completionEvent,
  previewDocument,
  streamBlockEvents,
  type MdxBlockEvent,
  type MdxEventDiagnostic,
  type StreamBlockEventsOptions,
} from "./stream-events.ts";

export type {
  BlockId,
  CompletedBlock,
  MdxEdit,
  MdxPreview,
  MdxStreamChange,
  MdxStreamCompletion,
  MdxStreamLimits,
  MdxStreamOptions,
  MdxStreamSnapshot,
  PreviewBlock,
  StreamBlock,
  StreamDependencies,
} from "./stream-types.ts";

export { MdxStream } from "./stream.ts";

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
