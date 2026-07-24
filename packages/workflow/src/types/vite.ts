/** Kind values for workflow directive. */
export type DirectiveKind = "workflow" | "step";

/** Describes the workflow transform metadata entry contract. */
export interface TransformMetadataEntry {
  readonly kind: DirectiveKind;
  readonly name: string;
  readonly generatedName: string;
  readonly workflowName: string;
  readonly version?: string;
}

/** Describes the workflow transform metadata contract. */
export interface TransformMetadata {
  readonly file: string;
  readonly entries: readonly TransformMetadataEntry[];
}

/** Describes the workflow transform manifest function contract. */
export interface TransformManifestFunction {
  readonly kind: DirectiveKind;
  readonly exportName: string;
  readonly localName: string;
  readonly generatedName: string;
  readonly workflowName: string;
  readonly version?: string;
}

/** Describes the workflow transform manifest import edge contract. */
export interface TransformManifestImportEdge {
  readonly source: string;
  readonly importName: string;
  readonly localName: string;
  readonly kind: DirectiveKind;
  readonly workflowName: string;
  readonly version?: string;
}

/** Describes the workflow transform manifest contract. */
export interface TransformManifest {
  readonly file: string;
  readonly functions: readonly TransformManifestFunction[];
  readonly imports: readonly TransformManifestImportEdge[];
}

/** Options for workflow transform. */
export interface TransformOptions {
  readonly root?: string;
  readonly name?: (localName: string, file: string, kind: DirectiveKind) => string;
  readonly version?: string | ((workflowName: string, file: string) => string | undefined);
  readonly manifests?: readonly TransformManifest[];
  readonly sourcemap?: boolean;
  readonly runtimeImport?: string;
}

/** Result returned by workflow transform. */
export interface TransformResult {
  readonly code: string;
  readonly map?: unknown;
  readonly metadata: TransformMetadata;
  readonly manifest: TransformManifest;
}

/** Options for workflow build-tool plugins. */
export interface WorkflowPluginOptions extends TransformOptions {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

/** Options for workflow Vite plugin. */
export type VitePluginOptions = WorkflowPluginOptions;
