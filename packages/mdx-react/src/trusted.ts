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
import { isObject, isFunction } from "@temelj/value";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";

import type { CompiledContentModule } from "./types.ts";

const asyncFunctionConstructor: Function = Object.getPrototypeOf(async function () {}).constructor;

const mdxRuntime = Object.freeze({ ...jsxRuntime, ...jsxDevRuntime });

export interface TrustedMdxImportContext {
  readonly baseUrl?: string;
  readonly sourceName: string;
}

export type TrustedMdxImportResolver<TModule extends object = object> = (
  specifier: string,
  context: TrustedMdxImportContext,
) => TModule | Promise<TModule>;

export interface TrustedMdxEvaluationOptions<TScope extends object = object> {
  readonly baseUrl?: string;
  readonly resolveImport?: TrustedMdxImportResolver;
  readonly scope?: Readonly<TScope>;
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

export type CompileTrustedMdxOptions<TScope extends object = object> = Omit<
  CompileMdxOptions,
  "outputFormat"
> &
  TrustedMdxEvaluationOptions<TScope>;

export type CompileTrustedMdxSchemaOptions<
  TSchema extends Schema,
  TScope extends object = object,
> = Omit<CompileMdxSchemaOptions<TSchema>, "outputFormat"> & TrustedMdxEvaluationOptions<TScope>;

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
export async function evaluateTrustedMdx<TScope extends object>(
  artifact: FunctionBodyCompileArtifact,
  options: Readonly<TrustedMdxEvaluationOptions<TScope>> = {},
): Promise<TrustedMdxEvaluationOutcome> {
  const missingResolver = artifact.imports.length > 0 && options.resolveImport === undefined;

  if (missingResolver) {
    return evaluationFailure(
      "mdx.evaluation.importResolver",
      `MDX imports require resolveImport: ${artifact.imports.join(", ")}`,
    );
  }

  const scope = options.scope ?? Object.freeze({});
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

    if (!isObject(resolved) && !isFunction(resolved)) {
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

    if (!isFunction(evaluator)) {
      throw new TypeError("Async function construction did not return a function");
    }

    const result: unknown = await evaluator(
      mdxRuntime,
      resolveImport,
      artifact.frontmatter,
      ...Object.values(scope),
    );

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

export function compileTrustedMdx<TSchema extends Schema, TScope extends object>(
  source: string | SourceFile,
  options: Readonly<CompileTrustedMdxSchemaOptions<TSchema, TScope>>,
): Promise<TrustedMdxCompileOutcome<SchemaOutput<TSchema>>>;
export function compileTrustedMdx<TScope extends object>(
  source: string | SourceFile,
  options?: Readonly<CompileTrustedMdxOptions<TScope>>,
): Promise<TrustedMdxCompileOutcome<FrontmatterObject>>;
export async function compileTrustedMdx<TScope extends object>(
  source: string | SourceFile,
  options: Readonly<
    CompileTrustedMdxOptions<TScope> & { readonly frontmatterSchema?: Schema }
  > = {},
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
  return isObject(value) && value !== null && "default" in value && isFunction(value.default);
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
