import type {
  CompileOptions,
  CompileResult,
  FrontmatterObject,
  FunctionBodyCompileArtifact,
  ProcessInput,
  ProcessorOptions,
} from "@temelj/mdx";
import type { Schema, SchemaOutput } from "@temelj/standard-schema";

import { compile, Processor } from "@temelj/mdx";
import { isObject, isFunction } from "@temelj/value";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";

import type { CompiledContentModule } from "./types.ts";

import { EvaluationError } from "./errors.ts";

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

export type CompileTrustedMdxOptions<TScope extends object = object> = ProcessorOptions &
  Omit<CompileOptions, "outputFormat" | "source"> &
  TrustedMdxEvaluationOptions<TScope> & { readonly signal?: AbortSignal };

export type CompileTrustedMdxSchemaOptions<
  TSchema extends Schema,
  TScope extends object = object,
> = CompileTrustedMdxOptions<TScope> & { readonly frontmatterSchema: TSchema };

export interface TrustedMdxCompileResult<TFrontmatter = FrontmatterObject> extends CompileResult<
  TFrontmatter,
  "functionBody"
> {
  readonly module: CompiledContentModule;
}

/**
 * Evaluates an explicitly trusted function-body artifact.
 * @throws {EvaluationError} Invalid bindings, imports, exports, or failed execution.
 */
export async function evaluateTrustedMdx<TScope extends object>(
  artifact: FunctionBodyCompileArtifact,
  options: Readonly<TrustedMdxEvaluationOptions<TScope>> = {},
): Promise<CompiledContentModule> {
  const sourceName = artifact.map.sources[0] ?? "source.mdx";
  const missingResolver = artifact.imports.length > 0 && options.resolveImport === undefined;

  if (missingResolver) {
    throw EvaluationError.missingImportResolver(sourceName, artifact.imports);
  }

  const scope = options.scope ?? Object.freeze({});
  const scopeNames = Object.keys(scope);
  validateScopeNames(scopeNames, sourceName);

  const resolveImport = async (specifier: string): Promise<object> => {
    const resolver = options.resolveImport;

    if (resolver === undefined) {
      throw EvaluationError.missingImportResolver(sourceName, [specifier]);
    }

    let resolved: object;

    try {
      resolved = await resolver(specifier, { baseUrl: options.baseUrl, sourceName });
    } catch (cause) {
      throw EvaluationError.importResolutionFailed(sourceName, specifier, cause);
    }

    if (!isObject(resolved) && !isFunction(resolved)) {
      throw EvaluationError.invalidImportModule(sourceName, specifier);
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
      throw EvaluationError.invalidModule(sourceName);
    }

    return result;
  } catch (cause) {
    if (cause instanceof EvaluationError) {
      throw cause;
    }

    throw EvaluationError.executionFailed(sourceName, cause);
  }
}

/**
 * Parses, transforms, compiles, and evaluates explicitly trusted MDX.
 * @throws {MdxError} Parsing, transformation, compilation, or evaluation fails.
 */
export function compileTrustedMdx<TSchema extends Schema, TScope extends object>(
  source: ProcessInput,
  options: Readonly<CompileTrustedMdxSchemaOptions<TSchema, TScope>>,
): Promise<TrustedMdxCompileResult<SchemaOutput<TSchema>>>;
export function compileTrustedMdx<TScope extends object>(
  source: ProcessInput,
  options?: Readonly<CompileTrustedMdxOptions<TScope>>,
): Promise<TrustedMdxCompileResult<FrontmatterObject>>;
export async function compileTrustedMdx<TScope extends object>(
  source: ProcessInput,
  options: Readonly<
    CompileTrustedMdxOptions<TScope> & { readonly frontmatterSchema?: Schema }
  > = {},
): Promise<TrustedMdxCompileResult<unknown>> {
  const transformed = await new Processor(options).transform(source, options);

  const compiled = await compile(transformed, {
    ...options.html,
    ...options,
    outputFormat: "functionBody",
  });

  const module = await evaluateTrustedMdx(compiled.artifact, options);

  return Object.freeze({ ...compiled, module });
}

function validateScopeNames(names: readonly string[], sourceName: string): void {
  const reserved = new Set(["__mdxRuntime", "__resolveMdxImport", "frontmatter"]);

  for (const name of names) {
    if (reserved.has(name)) {
      throw EvaluationError.invalidScopeBindings(sourceName, [name]);
    }
  }

  try {
    Reflect.construct(asyncFunctionConstructor, [...names, ""]);
  } catch (cause) {
    throw EvaluationError.invalidScopeBindings(sourceName, names, { cause });
  }
}

function isCompiledContentModule(value: unknown): value is CompiledContentModule {
  return isObject(value) && value !== null && "default" in value && isFunction(value.default);
}
