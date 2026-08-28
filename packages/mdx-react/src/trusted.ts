import type {
  CompileMdxOptions,
  CompileMdxSchemaOptions,
  Diagnostic,
  DocumentNode,
  FrontmatterObject,
  FunctionBodyCompileArtifact,
  MdxCompileOutcome,
  SourceFile,
} from "@temelj/mdx";
import type { Schema, SchemaOutput } from "@temelj/standard-schema";

import { compileMdx } from "@temelj/mdx";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";

import type { CompiledContentModule } from "./types.ts";

const asyncFunctionConstructor: Function = Object.getPrototypeOf(async function () {}).constructor;
const mdxRuntime = Object.freeze({ ...jsxRuntime, ...jsxDevRuntime });

export interface TrustedMdxImportContext {
  readonly baseUrl?: string;
  readonly sourceName: string;
}

export type TrustedMdxImportResolver = (
  specifier: string,
  context: TrustedMdxImportContext,
) => unknown;

export interface TrustedMdxEvaluationOptions {
  readonly baseUrl?: string;
  readonly resolveImport?: TrustedMdxImportResolver;
  readonly scope?: Readonly<Record<string, unknown>>;
}

export type TrustedMdxEvaluationOutcome =
  | Readonly<{
      kind: "evaluated";
      module: CompiledContentModule;
    }>
  | Readonly<{
      kind: "evaluationFailed";
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>;

export type CompileTrustedMdxOptions = Omit<CompileMdxOptions, "outputFormat"> &
  TrustedMdxEvaluationOptions;

export type CompileTrustedMdxSchemaOptions<TSchema extends Schema> = Omit<
  CompileMdxSchemaOptions<TSchema>,
  "outputFormat"
> &
  TrustedMdxEvaluationOptions;

export type TrustedMdxCompileOutcome<TFrontmatter = FrontmatterObject> =
  | Readonly<{
      kind: "compiled";
      file: SourceFile;
      document: DocumentNode;
      artifact: FunctionBodyCompileArtifact;
      frontmatter: TFrontmatter;
      module: CompiledContentModule;
      diagnostics: readonly Diagnostic[];
    }>
  | Exclude<MdxCompileOutcome<TFrontmatter>, { kind: "compiled" }>
  | Readonly<{
      kind: "evaluationFailed";
      file: SourceFile;
      document: DocumentNode;
      artifact: FunctionBodyCompileArtifact;
      frontmatter: TFrontmatter;
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>;

/** Evaluates an explicitly trusted function-body artifact. */
export async function evaluateTrustedMdx(
  artifact: FunctionBodyCompileArtifact,
  options: Readonly<TrustedMdxEvaluationOptions> = {},
): Promise<TrustedMdxEvaluationOutcome> {
  const missingResolver = artifact.imports.length > 0 && options.resolveImport === undefined;
  if (missingResolver) {
    return evaluationFailure(
      "mdx.evaluation.importResolver",
      `MDX imports require resolveImport: ${artifact.imports.join(", ")}`,
    );
  }

  const scope: Readonly<Record<string, unknown>> = options.scope ?? Object.freeze({});
  const scopeNames = Object.keys(scope);
  validateScopeNames(scopeNames);
  const resolveImport = async (specifier: string): Promise<object> => {
    const resolver = options.resolveImport;
    if (resolver === undefined) {
      throw new Error(`No resolver was provided for ${JSON.stringify(specifier)}`);
    }
    const resolved = await resolver(specifier, {
      baseUrl: options.baseUrl,
      sourceName: artifact.map.sources[0] ?? "source.mdx",
    });
    if ((typeof resolved !== "object" && typeof resolved !== "function") || resolved === null) {
      throw new TypeError(`Resolver returned a non-module value for ${JSON.stringify(specifier)}`);
    }
    return resolved;
  };

  try {
    const evaluator: unknown = Reflect.construct(asyncFunctionConstructor, [
      "__mdxRuntime",
      "__resolveMdxImport",
      "frontmatter",
      ...scopeNames,
      artifact.code,
    ]);
    if (typeof evaluator !== "function") {
      throw new TypeError("Async function construction did not return a function");
    }
    const result: unknown = await Reflect.apply(evaluator, undefined, [
      mdxRuntime,
      resolveImport,
      artifact.frontmatter,
      ...scopeNames.map((name) => scope[name]),
    ]);
    if (!isCompiledContentModule(result)) {
      throw new TypeError("Trusted MDX did not evaluate to a module with a default component");
    }
    return Object.freeze({
      kind: "evaluated",
      module: result,
    });
  } catch (cause) {
    return evaluationFailure(
      "mdx.evaluation.failed",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

export function compileTrustedMdx<TSchema extends Schema>(
  source: string | SourceFile,
  options: Readonly<CompileTrustedMdxSchemaOptions<TSchema>>,
): Promise<TrustedMdxCompileOutcome<SchemaOutput<TSchema>>>;
export function compileTrustedMdx(
  source: string | SourceFile,
  options?: Readonly<CompileTrustedMdxOptions>,
): Promise<TrustedMdxCompileOutcome<FrontmatterObject>>;
export async function compileTrustedMdx(
  source: string | SourceFile,
  options: Readonly<CompileTrustedMdxOptions & { readonly frontmatterSchema?: Schema }> = {},
): Promise<TrustedMdxCompileOutcome<unknown>> {
  const compiled = await compileMdx(source, { ...options, outputFormat: "functionBody" });
  if (compiled.kind !== "compiled") {
    return compiled;
  }
  if (compiled.artifact.format !== "functionBody") {
    throw new Error("compileMdx returned the wrong artifact format");
  }
  const evaluated = await evaluateTrustedMdx(compiled.artifact, options);
  if (evaluated.kind === "evaluationFailed") {
    return Object.freeze({
      kind: "evaluationFailed",
      file: compiled.file,
      document: compiled.document,
      artifact: compiled.artifact,
      frontmatter: compiled.frontmatter,
      diagnostics: evaluated.diagnostics,
    });
  }
  return Object.freeze({
    kind: "compiled",
    file: compiled.file,
    document: compiled.document,
    artifact: compiled.artifact,
    frontmatter: compiled.frontmatter,
    module: evaluated.module,
    diagnostics: compiled.diagnostics,
  });
}

function validateScopeNames(names: readonly string[]): void {
  const reserved = new Set(["__mdxRuntime", "__resolveMdxImport", "frontmatter"]);
  for (const name of names) {
    if (reserved.has(name)) {
      throw new TypeError(`Invalid trusted MDX scope binding: ${JSON.stringify(name)}`);
    }
  }
  try {
    Reflect.construct(asyncFunctionConstructor, [...names, ""]);
  } catch {
    throw new TypeError(
      `Invalid trusted MDX scope bindings: ${names.map((name) => JSON.stringify(name)).join(", ")}`,
    );
  }
}

function isCompiledContentModule(value: unknown): value is CompiledContentModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "default" in value &&
    typeof value.default === "function"
  );
}

function evaluationFailure(
  code: string,
  message: string,
): Extract<
  TrustedMdxEvaluationOutcome,
  {
    kind: "evaluationFailed";
  }
> {
  const diagnostic: Diagnostic = Object.freeze({ severity: "error", code, message });
  const diagnostics: readonly [Diagnostic] = Object.freeze([diagnostic]);
  return Object.freeze({ kind: "evaluationFailed", diagnostics });
}
