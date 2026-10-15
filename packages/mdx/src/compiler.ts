import type { Schema, SchemaIssue, SchemaOutput } from "@temelj/standard-schema";

import { isObject, isBoolean, isNumber, isBigInt, isString } from "@temelj/value";

import type { HtmlRenderOptions } from "./html-lower.ts";
import type { HtmlRootNode } from "./html.ts";
import type { DocumentNode, FrontmatterObject, SourceRange } from "./model.ts";
import type { ParseResult } from "./parser.ts";
import type { SourceFile } from "./source.ts";

import { analyzeDocument, type CompileAnalysis } from "./compile-analysis.ts";
import { contentUsesAwait, emitContent } from "./compile-emit.ts";
import { createDiagnostic } from "./diagnostics.ts";
import {
  CompileError,
  ConfigurationError,
  FrontmatterError,
  LimitError,
  MdxError,
} from "./errors.ts";
import { lowerHtml } from "./html-lower.ts";
import { javascriptPropertyName } from "./javascript-ast.ts";
import { parseJavaScriptProgram } from "./javascript.ts";
import { documentFrontmatter } from "./model.ts";
import { CodeWriter, type SourceMap } from "./source-map.ts";

const defaultMaximumGeneratedCodeBytes = 10 * 1024 * 1024;

const defaultMaximumSourceMapBytes = 5 * 1024 * 1024;

/** Compiled content renders the same elements as `lowerHtml` with these options. */
export interface CompileOptions extends HtmlRenderOptions {
  /** Emit `jsxDEV` calls with authored source locations. */
  readonly development?: boolean;
  /** Package providing `jsx-runtime`. */
  readonly jsxImportSource?: string;
  /** Maximum UTF-8 size of generated JavaScript. */
  readonly maximumGeneratedCodeBytes?: number;
  /** Maximum UTF-8 size of the serialized source map. */
  readonly maximumSourceMapBytes?: number;
  /** Optional generated filename written into the source map. */
  readonly outputName?: string;
  /** Optional package providing a `useMDXComponents` export. */
  readonly providerImportSource?: string;
  /** Original MDX filename written into the source map. */
  readonly sourceName?: string;
  /** JavaScript shape emitted by the compiler. */
  readonly outputFormat?: CompileOutputFormat;
}

export type CompileOutputFormat = "functionBody" | "program";

/**
 * The components compiled content reads from `props.components`: element
 * overrides by tag name, authored JSX components by name, and three reserved
 * entries whose names cannot collide with either.
 */
export interface CompiledComponents<TComponent = unknown> {
  readonly [name: string]: TComponent | undefined;
  /** Receives `code`, `language`, `meta`, `node`, and `status`. Defaults to `<pre><code>`. */
  readonly codeBlock?: TComponent;
  /** Receives `source`, `style`, and `meta`. Defaults to a readable code fallback. */
  readonly mathFormula?: TComponent;
  /** Wraps the whole document and receives its props plus `children`. */
  readonly wrapper?: TComponent;
}

export type MdxTransportValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | readonly MdxTransportValue[]
  | Readonly<{ [key: string]: MdxTransportValue }>;

interface CompileArtifactBase {
  readonly code: string;
  readonly frontmatter: MdxTransportValue;
  readonly map: SourceMap;
}

export interface ProgramCompileArtifact extends CompileArtifactBase {
  readonly format: "program";
}

export interface FunctionBodyCompileArtifact extends CompileArtifactBase {
  readonly format: "functionBody";
  readonly imports: readonly string[];
}

export type CompileArtifact = ProgramCompileArtifact | FunctionBodyCompileArtifact;

export interface CompileSchemaOptions<TSchema extends Schema> extends CompileOptions {
  /** Standard Schema validation for decoded frontmatter. */
  readonly frontmatterSchema: TSchema;
}

export interface CompileResult<
  TFrontmatter = FrontmatterObject,
  TFormat extends CompileOutputFormat = CompileOutputFormat,
> extends ParseResult {
  readonly artifact: Extract<CompileArtifact, { readonly format: TFormat }>;
  readonly frontmatter: TFrontmatter;
}

/** Emits JavaScript for a strict document. Throws for configuration errors and compiler limits. */
function emitArtifact(
  document: DocumentNode,
  options: Readonly<CompileOptions & { readonly source: SourceFile }>,
  frontmatter: MdxTransportValue,
): CompileArtifact {
  try {
    if (
      options.maximumGeneratedCodeBytes !== undefined &&
      (!Number.isSafeInteger(options.maximumGeneratedCodeBytes) ||
        options.maximumGeneratedCodeBytes < 0)
    ) {
      throw ConfigurationError.invalidCompilerLimit(
        "maximumGeneratedCodeBytes",
        options.maximumGeneratedCodeBytes,
      );
    }

    if (
      options.maximumSourceMapBytes !== undefined &&
      (!Number.isSafeInteger(options.maximumSourceMapBytes) || options.maximumSourceMapBytes < 0)
    ) {
      throw ConfigurationError.invalidCompilerLimit(
        "maximumSourceMapBytes",
        options.maximumSourceMapBytes,
      );
    }

    const content = lowerHtml(document, options);
    const analysis = analyzeDocument(document, content, options);
    const usesAwait = contentUsesAwait(content);

    const format = options.outputFormat ?? "functionBody";
    const writer = new CodeWriter(options.source);
    emitModulePreamble(writer, analysis, options, format);
    emitContentFunction(writer, content, analysis, options, usesAwait);
    emitPublicComponent(writer, analysis, options, usesAwait, format);

    if (analysis.scope.missingReferences.size > 0) {
      emitMissingReferenceHelper(writer);
    }

    if (format === "functionBody") {
      writer.write(`return {${[...analysis.esm.exports, "default: Content"].join(", ")}};\n`);
    }

    const code = writer.toString();
    enforceGeneratedCodeLimit(options.source, code, options.maximumGeneratedCodeBytes);

    try {
      // The output is valid by construction; parsing it once guards that invariant.
      parseJavaScriptProgram(
        format === "program" ? code : `async function __evaluateMdx(){\n${code}\n}`,
      );
    } catch (cause) {
      throw CompileError.generatedProgramInvalid(cause);
    }

    const map = writer.sourceMap(analysis.scope.sourceName, options.outputName);
    enforceSourceMapLimit(options.source, map, options.maximumSourceMapBytes);

    return format === "program"
      ? Object.freeze({ format, code, map, frontmatter })
      : Object.freeze({
          format,
          code,
          map,
          imports: Object.freeze(
            options.providerImportSource === undefined ||
              analysis.esm.imports.includes(options.providerImportSource)
              ? [...analysis.esm.imports]
              : [...analysis.esm.imports, options.providerImportSource],
          ),
          frontmatter,
        });
  } catch (cause) {
    if (cause instanceof MdxError) {
      throw cause;
    }

    throw CompileError.generationFailed(cause);
  }
}

/**
 * Validates frontmatter and compiles a parsed or transformed document without executing it.
 * @throws {FrontmatterError} Invalid schema output or unsupported transport data.
 * @throws {LimitError} Generated code or its source map exceeds a configured limit.
 * @throws {CompileError} JavaScript generation fails.
 * @throws {ConfigurationError} Invalid compiler options.
 */
export function compile<
  TSchema extends Schema,
  TFormat extends CompileOutputFormat = "functionBody",
>(
  input: ParseResult,
  options: Readonly<CompileSchemaOptions<TSchema> & { readonly outputFormat?: TFormat }>,
): Promise<CompileResult<SchemaOutput<TSchema>, TFormat>>;
export function compile<TFormat extends CompileOutputFormat = "functionBody">(
  input: ParseResult,
  options?: Readonly<CompileOptions & { readonly outputFormat?: TFormat }>,
): Promise<CompileResult<FrontmatterObject, TFormat>>;
export async function compile(
  input: ParseResult,
  options: Readonly<CompileOptions & { readonly frontmatterSchema?: Schema }> = {},
): Promise<CompileResult<unknown>> {
  const frontmatterNode = documentFrontmatter(input.document);
  let frontmatter: unknown = frontmatterNode?.data ?? Object.freeze({});

  if (options.frontmatterSchema !== undefined) {
    const validated = await options.frontmatterSchema["~standard"].validate(frontmatter);

    if (validated.issues !== undefined) {
      const diagnostics = validated.issues.map((issue) =>
        createDiagnostic({
          severity: "error",
          code: "mdx.frontmatter.schema",
          message: formatSchemaIssue(issue),
          span: fileSpan(input.file, frontmatterNode?.origin),
        }),
      );

      throw FrontmatterError.schemaValidationFailed(input.file, diagnostics, validated.issues);
    }

    frontmatter = validated.value;
  }

  const transported = copyTransportValue(frontmatter, "frontmatter", {
    file: input.file,
    origin: frontmatterNode?.origin,
    ancestors: new WeakSet(),
  });

  const artifact = emitArtifact(input.document, { ...options, source: input.file }, transported);

  return Object.freeze({
    file: input.file,
    document: input.document,
    diagnostics: input.diagnostics,
    artifact,
    frontmatter,
  });
}

function formatSchemaIssue(issue: SchemaIssue): string {
  const path = issue.path?.map((part) => String(isObject(part) ? part.key : part)).join(".");

  return path === undefined || path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}

interface FrontmatterTransportContext {
  readonly file: SourceFile;
  readonly origin: SourceRange | undefined;
  readonly ancestors: WeakSet<object>;
}

function copyTransportValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Recursively validates external schema output against the MDX transport contract.
  value: unknown,
  path: string,
  context: FrontmatterTransportContext,
): MdxTransportValue {
  const { ancestors } = context;

  if (value === null || isBoolean(value) || isNumber(value) || isBigInt(value) || isString(value)) {
    return value;
  }

  if (!isObject(value)) {
    throw FrontmatterError.nonTransportableValue(
      context.file,
      context.origin,
      `${path} contains unsupported ${Object.prototype.toString.call(value)}`,
    );
  }

  if (ancestors.has(value)) {
    throw FrontmatterError.nonTransportableValue(
      context.file,
      context.origin,
      `${path} contains a cycle`,
    );
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    const output: MdxTransportValue[] = [];

    for (let index = 0; index < value.length; index++) {
      const item = copyTransportValue(value[index], `${path}[${index}]`, context);

      output.push(item);
    }

    ancestors.delete(value);

    return Object.freeze(output);
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    throw FrontmatterError.nonTransportableValue(
      context.file,
      context.origin,
      `${path} contains a non-plain object`,
    );
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw FrontmatterError.nonTransportableValue(
      context.file,
      context.origin,
      `${path} contains a symbol property`,
    );
  }

  const output: Record<string, MdxTransportValue> = {};

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) {
      continue;
    }

    if (!("value" in descriptor)) {
      throw FrontmatterError.nonTransportableValue(
        context.file,
        context.origin,
        `${path}.${key} is an accessor property`,
      );
    }

    const item = copyTransportValue(descriptor.value, `${path}.${key}`, context);

    output[key] = item;
  }

  ancestors.delete(value);

  return Object.freeze(output);
}

function fileSpan(
  file: SourceFile,
  range: SourceRange | undefined,
): Readonly<{ file: SourceFile; start: number; end: number }> | undefined {
  return range === undefined ? undefined : { file, start: range.start, end: range.end };
}

/**
 * Authored ESM, the JSX runtime, and the optional provider. A function body
 * receives the runtime as `__mdxRuntime` and resolves imports through
 * `__resolveMdxImport` instead of importing.
 */
function emitModulePreamble(
  writer: CodeWriter,
  analysis: CompileAnalysis,
  options: Readonly<CompileOptions>,
  format: CompileOutputFormat,
): void {
  for (const entry of analysis.esm.blocks) {
    writer.write(`${entry.code.trimEnd()}\n`, entry.origin);
  }

  const runtime = analysis.scope.development
    ? "{Fragment: _Fragment, jsxDEV: _jsxDEV}"
    : "{Fragment: _Fragment, jsx: _jsx, jsxs: _jsxs}";

  const importSource = `${options.jsxImportSource ?? "react"}/${
    analysis.scope.development ? "jsx-dev-runtime" : "jsx-runtime"
  }`;

  writer.write(
    format === "program"
      ? `import ${runtime.replaceAll(": ", " as ")} from ${JSON.stringify(importSource)};\n`
      : `const ${runtime} = __mdxRuntime;\n`,
  );

  if (options.providerImportSource !== undefined) {
    writer.write(
      format === "program"
        ? `import {useMDXComponents as _provideComponents} from ${JSON.stringify(options.providerImportSource)};\n`
        : `const {useMDXComponents: _provideComponents} = await __resolveMdxImport(${JSON.stringify(options.providerImportSource)});\n`,
    );
  }
}

function emitContentFunction(
  writer: CodeWriter,
  content: HtmlRootNode,
  analysis: CompileAnalysis,
  options: Readonly<CompileOptions>,
  usesAwait: boolean,
): void {
  writer.write(`${usesAwait ? "async " : ""}function _createContent(props) {\n`);
  writer.write("  const _components = {");
  const tags = [...analysis.intrinsicTags].sort();
  tags.forEach((tag, index) => {
    if (index > 0) {
      writer.write(", ");
    }

    writer.write(`${javascriptPropertyName(tag)}:${JSON.stringify(tag)}`);
  });

  if (options.providerImportSource !== undefined) {
    writer.write(`${tags.length === 0 ? "" : ", "}..._provideComponents()`);
  }

  writer.write(
    `${tags.length === 0 && options.providerImportSource === undefined ? "" : ", "}...props.components};\n`,
  );

  const components = [...analysis.scope.referencedComponents].sort();

  for (const component of components) {
    writer.write(`  const ${component} = _components[${JSON.stringify(component)}];\n`);
  }

  for (const [reference, component] of analysis.scope.missingReferences) {
    writer.write(
      `  if (!${reference}) _missingReference(${JSON.stringify(reference)}, ${component});\n`,
    );
  }

  writer.write("  return ");
  emitContent(writer, content, analysis);
  writer.write(";\n}\n");
}

function emitPublicComponent(
  writer: CodeWriter,
  analysis: CompileAnalysis,
  options: Readonly<CompileOptions>,
  usesAwait: boolean,
  format: CompileOutputFormat,
): void {
  writer.write(
    `${format === "program" ? "export default " : ""}${usesAwait ? "async " : ""}function Content(props = {}) {\n`,
  );
  const content = `${usesAwait ? "await " : ""}_createContent(props)`;

  if (analysis.esm.hasLayout) {
    writer.write(
      `  return ${runtimeCall(analysis, "Layout", `{...props, children: ${content}}`)};\n`,
    );
  } else {
    writer.write("  const {wrapper: Layout} = {");

    if (options.providerImportSource !== undefined) {
      writer.write("..._provideComponents(), ");
    }

    writer.write("...props.components};\n");
    writer.write(
      `  return Layout ? ${runtimeCall(analysis, "Layout", `{...props, children: ${content}}`)} : ${content};\n`,
    );
  }

  writer.write("}\n");
}

function emitMissingReferenceHelper(writer: CodeWriter): void {
  writer.write(
    "class ReferenceError extends Error {\n" +
      "  constructor(id, component) {\n" +
      '    super(`Expected ${component ? "component" : "object"} ${id} to be defined: you likely forgot to import, pass, or provide it.`);\n' +
      '    this.name = "ReferenceError";\n' +
      "  }\n" +
      "}\n" +
      "function _missingReference(id, component) {\n" +
      "  throw new ReferenceError(id, component);\n" +
      "}\n",
  );
}

function enforceGeneratedCodeLimit(
  file: SourceFile,
  code: string,
  configuredMaximum: number | undefined,
): void {
  const maximum = configuredMaximum ?? defaultMaximumGeneratedCodeBytes;
  const actual = new TextEncoder().encode(code).byteLength;

  if (actual > maximum) {
    throw LimitError.exceeded(file, "maximumGeneratedCodeBytes", maximum, undefined, actual);
  }
}

function enforceSourceMapLimit(
  file: SourceFile,
  map: SourceMap,
  configuredMaximum: number | undefined,
): void {
  const maximum = configuredMaximum ?? defaultMaximumSourceMapBytes;
  const actual = new TextEncoder().encode(JSON.stringify(map)).byteLength;

  if (actual > maximum) {
    throw LimitError.exceeded(file, "maximumSourceMapBytes", maximum, undefined, actual);
  }
}

function runtimeCall(analysis: CompileAnalysis, tag: string, properties: string): string {
  return analysis.scope.development
    ? `_jsxDEV(${tag}, ${properties}, undefined, false, undefined, undefined)`
    : `_jsx(${tag}, ${properties})`;
}
