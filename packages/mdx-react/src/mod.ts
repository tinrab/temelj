export {
  compiledComponents,
  CompiledContent,
  HtmlContent,
  SourceContent,
  type CompiledContentProps,
  type HtmlContentProps,
  type SourceContentProps,
} from "./content.tsx";

export {
  MdxBlockStore,
  type MdxBlockEventSource,
  type MdxBlockStoreOptions,
} from "./block-store.ts";

export type { DiagnosticFallback } from "./fallback.ts";

export { HighlightedCode, type HighlightedCodeProps } from "./highlighted-code.tsx";

export {
  defineMdxRegistry,
  type MdxRegistry,
  type MdxRegistryDefinition,
  type MdxRegistryEntry,
} from "./registry.ts";

export {
  StreamContent,
  useMdxBlockStatus,
  type MdxBlockStatus,
  type StreamContentProps,
} from "./stream-content.tsx";

export { StreamSourceContent, type StreamSourceContentProps } from "./stream-source-content.tsx";

export { MdxStreamStore, type MdxStreamStoreOptions, type MdxStreamView } from "./stream-store.ts";

export type { MdxConsumeOptions, MdxPublishScheduler, MdxTextSource } from "./transport.ts";

export {
  compileTrustedMdx,
  evaluateTrustedMdx,
  type CompileTrustedMdxOptions,
  type CompileTrustedMdxSchemaOptions,
  type TrustedMdxCompileResult,
  type TrustedMdxEvaluationOptions,
  type TrustedMdxImportContext,
  type TrustedMdxImportResolver,
} from "./trusted.ts";

export type {
  CompiledContentComponent,
  CompiledContentModule,
  CompiledContentRuntimeProps,
  MathComponent,
  MathComponentProps,
  MdxCodeBlockComponentProps,
  MdxComponentNode,
  MdxComponentProps,
  MdxElementComponentNode,
  MdxJsxComponentNode,
  MdxJsxComponentOptions,
  MdxLiteralPropValue,
  MdxMarkdownComponents,
  MdxPendingComponents,
  PendingMdxJsxFallbackProps,
  PendingMdxJsxProps,
  PendingMdxMarkdownProps,
} from "./types.ts";

export { useMdxBlocks, type UseMdxBlocksResult } from "./use-mdx-blocks.ts";

export { useMdxStream, type UseMdxStreamResult } from "./use-mdx-stream.ts";

export { EvaluationError, type EvaluationIssue } from "./errors.ts";
