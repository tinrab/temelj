export {
  CompiledContent,
  HtmlContent,
  SourceContent,
  type CompiledContentProps,
  type HtmlContentProps,
  type SourceContentProps,
} from "./content.tsx";

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

export {
  MdxStreamStore,
  type MdxConsumeOptions,
  type MdxStreamStoreOptions,
  type MdxStreamView,
  type MdxTextSource,
} from "./stream-store.ts";

export {
  compileTrustedMdx,
  evaluateTrustedMdx,
  type CompileTrustedMdxOptions,
  type CompileTrustedMdxSchemaOptions,
  type TrustedMdxCompileOutcome,
  type TrustedMdxEvaluationOptions,
  type TrustedMdxEvaluationOutcome,
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

export { useMdxStream, type UseMdxStreamResult } from "./use-mdx-stream.ts";
