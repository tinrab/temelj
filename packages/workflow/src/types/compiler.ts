import type { SourceMapCompact } from "unplugin";

export type DirectiveKind = "workflow" | "step";

export interface TransformMetadataEntry {
  readonly kind: DirectiveKind;
  readonly name: string;
  readonly generatedName: string;
  readonly workflowName: string;
  readonly version?: string;
}

export interface TransformMetadata {
  readonly file: string;
  readonly entries: readonly TransformMetadataEntry[];
}

export interface TransformManifestFunction {
  readonly kind: DirectiveKind;
  readonly exportName: string;
  readonly localName: string;
  readonly generatedName: string;
  readonly workflowName: string;
  readonly version?: string;
}

export interface TransformManifestImportEdge {
  readonly source: string;
  readonly importName: string;
  readonly localName: string;
  readonly kind: DirectiveKind;
  readonly workflowName: string;
  readonly version?: string;
}

export interface TransformManifest {
  readonly file: string;
  readonly functions: readonly TransformManifestFunction[];
  readonly imports: readonly TransformManifestImportEdge[];
}

export interface TransformOptions {
  readonly root?: string;
  readonly name?: (localName: string, file: string, kind: DirectiveKind) => string;
  readonly version?: string | ((workflowName: string, file: string) => string | undefined);
  readonly manifests?: readonly TransformManifest[];
  readonly sourcemap?: boolean;
  readonly runtimeImport?: string;
}

/** Source map emitted by the workflow compiler, including the original source text. */
export interface SourceMap extends SourceMapCompact {
  sourcesContent: string[];
}

export interface TransformResult {
  readonly code: string;
  readonly map?: SourceMap;
  readonly metadata: TransformMetadata;
  readonly manifest: TransformManifest;
}

export interface PluginOptions extends TransformOptions {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}
