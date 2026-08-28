import type { Schema, SchemaIssue, SchemaOutput } from "@temelj/standard-schema";

import type { Diagnostic } from "./diagnostics.ts";
import type { FrontmatterObject } from "./model.ts";
import type { ParserLimit, ParserLimits } from "./parser.ts";
import type { DocumentPlugin } from "./plugin.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

import { analyzeDocument, type CompilerState } from "./compile-analysis.ts";
import { emitContent, documentUsesAwait } from "./compile.ts";
import { createDiagnostic, DiagnosticBag, hasErrorDiagnostics } from "./diagnostics.ts";
import { CompileError, ConfigurationError, MdxError } from "./errors.ts";
import { toFunctionBody } from "./function-body.ts";
import { javascriptPropertyName } from "./javascript-ast.ts";
import { parseJavaScriptProgram } from "./javascript.ts";
import { DocumentNode, FrontmatterTemporal } from "./model.ts";
import { runDocumentTransforms } from "./native-runtime.ts";
import { parse } from "./parser.ts";
import { normalizeDocumentPlugins } from "./plugin-internal.ts";
import { CodeWriter, type SourceMap } from "./source-map.ts";
import { SourceFile } from "./source.ts";

const defaultMaximumGeneratedCodeBytes = 10 * 1024 * 1024;
const defaultMaximumSourceMapBytes = 5 * 1024 * 1024;

export interface CompileOptions {
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

export type CompilerLimit = "maximumGeneratedCodeBytes" | "maximumSourceMapBytes";
export type MdxCompileLimit = ParserLimit | CompilerLimit;

export interface CompileDocumentOptions extends CompileOptions {
  readonly frontmatter?: MdxTransportValue;
}

export interface CompileMdxOptions extends CompileOptions {
  readonly documentPlugins?: readonly DocumentPlugin[];
  readonly parserLimits?: ParserLimits;
  readonly signal?: AbortSignal;
  readonly syntax?: SyntaxOptions;
}

export interface CompileMdxSchemaOptions<TSchema extends Schema> extends CompileMdxOptions {
  readonly frontmatterSchema: TSchema;
}

export type MdxCompileOutcome<TFrontmatter = FrontmatterObject> =
  | Readonly<{
      kind: "compiled";
      file: SourceFile;
      document: DocumentNode;
      artifact: CompileArtifact;
      frontmatter: TFrontmatter;
      diagnostics: readonly Diagnostic[];
    }>
  | Readonly<{
      kind: "invalid";
      file: SourceFile;
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>
  | Readonly<{
      kind: "limitExceeded";
      file: SourceFile;
      limit: MdxCompileLimit;
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>;

/** Compiles a strict semantic document without parsing or running plugins. */
export function compileDocument(
  document: DocumentNode,
  options: Readonly<CompileDocumentOptions> = {},
): CompileArtifact {
  try {
    if (
      options.outputFormat !== undefined &&
      options.outputFormat !== "functionBody" &&
      options.outputFormat !== "program"
    ) {
      ConfigurationError.invalidCompilerOutputFormat(options.outputFormat);
    }
    if (
      options.maximumGeneratedCodeBytes !== undefined &&
      (!Number.isSafeInteger(options.maximumGeneratedCodeBytes) ||
        options.maximumGeneratedCodeBytes < 0)
    ) {
      ConfigurationError.invalidCompilerLimit(
        "maximumGeneratedCodeBytes",
        options.maximumGeneratedCodeBytes,
      );
    }
    if (
      options.maximumSourceMapBytes !== undefined &&
      (!Number.isSafeInteger(options.maximumSourceMapBytes) || options.maximumSourceMapBytes < 0)
    ) {
      ConfigurationError.invalidCompilerLimit(
        "maximumSourceMapBytes",
        options.maximumSourceMapBytes,
      );
    }
    const state = analyzeDocument(document, options);
    const usesAwait = documentUsesAwait(document);

    const writer = new CodeWriter(document.origin?.file);
    emitModulePreamble(writer, state, options);
    emitContentFunction(writer, document, state, options, usesAwait);
    emitPublicComponent(writer, state, options, usesAwait);
    if (state.missingReferences.size > 0) {
      emitMissingReferenceHelper(writer);
    }

    const program = writer.toString();
    const runtimeImportSource = `${options.jsxImportSource ?? "react"}/${
      options.development ? "jsx-dev-runtime" : "jsx-runtime"
    }`;
    const functionBody =
      options.outputFormat === "program" ? undefined : toFunctionBody(program, runtimeImportSource);
    const code = functionBody?.code ?? program;
    enforceGeneratedCodeLimit(code, options.maximumGeneratedCodeBytes);
    try {
      if (functionBody === undefined) {
        parseJavaScriptProgram(code);
      }
    } catch (cause) {
      CompileError.generatedProgramInvalid(cause);
    }

    const map = writer.sourceMap(options.sourceName ?? "source.mdx", options.outputName);
    enforceSourceMapLimit(map, options.maximumSourceMapBytes);
    const frontmatter = options.frontmatter ?? Object.freeze({});
    return functionBody === undefined
      ? Object.freeze({ format: "program", code, map, frontmatter })
      : Object.freeze({
          format: "functionBody",
          code,
          map,
          imports: functionBody.imports,
          frontmatter,
        });
  } catch (cause) {
    if (cause instanceof MdxError) {
      throw cause;
    }
    CompileError.generationFailed(cause);
  }
}

/** Parses, transforms, validates frontmatter, and compiles MDX without executing it. */
export function compileMdx<TSchema extends Schema>(
  input: string | SourceFile,
  options: Readonly<CompileMdxSchemaOptions<TSchema>>,
): Promise<MdxCompileOutcome<SchemaOutput<TSchema>>>;
export function compileMdx(
  input: string | SourceFile,
  options?: Readonly<CompileMdxOptions>,
): Promise<MdxCompileOutcome<FrontmatterObject>>;
export async function compileMdx(
  input: string | SourceFile,
  options: Readonly<CompileMdxOptions & { readonly frontmatterSchema?: Schema }> = {},
): Promise<MdxCompileOutcome<unknown>> {
  options.signal?.throwIfAborted();
  const parsed = parse(input, { syntax: options.syntax, limits: options.parserLimits });
  if (parsed.kind !== "parsed") {
    return parsed;
  }
  const diagnostics = new DiagnosticBag(parsed.diagnostics);
  const document = await runDocumentTransforms({
    diagnostics,
    document: parsed.document,
    documentPlugins: normalizeDocumentPlugins(options.documentPlugins ?? []),
    file: parsed.file,
    signal: options.signal,
    syntax: Object.freeze({ ...options.syntax }),
  });
  const transformedDiagnostics = diagnostics.snapshot();
  if (hasErrorDiagnostics(transformedDiagnostics)) {
    return invalidOutcome(parsed.file, transformedDiagnostics);
  }
  const frontmatterInput = document.frontmatter?.data ?? Object.freeze({});
  const frontmatter = await validateFrontmatter(
    parsed.file,
    document,
    frontmatterInput,
    options.frontmatterSchema,
  );
  if (frontmatter.kind === "invalid") {
    return frontmatter;
  }
  try {
    const transportedFrontmatter = transportFrontmatter(frontmatter.value);
    if (transportedFrontmatter.kind === "unsupported") {
      const diagnostic = createDiagnostic({
        severity: "error",
        code: "mdx.frontmatter.transport",
        message: "Validated frontmatter must contain transportable values",
        notes: [transportedFrontmatter.reason],
        span: document.frontmatter?.origin,
      });
      return invalidOutcome(parsed.file, [diagnostic]);
    }
    const artifact = compileDocument(document, {
      development: options.development,
      frontmatter: transportedFrontmatter.value,
      jsxImportSource: options.jsxImportSource,
      maximumGeneratedCodeBytes: options.maximumGeneratedCodeBytes,
      maximumSourceMapBytes: options.maximumSourceMapBytes,
      outputFormat: options.outputFormat,
      outputName: options.outputName,
      providerImportSource: options.providerImportSource,
      sourceName: options.sourceName,
    });
    return Object.freeze({
      kind: "compiled",
      file: parsed.file,
      document,
      artifact,
      frontmatter: frontmatter.value,
      diagnostics: transformedDiagnostics,
    });
  } catch (cause) {
    if (!(cause instanceof CompileError)) {
      throw cause;
    }
    const limit = compilerLimit(cause);
    if (limit === undefined) {
      throw cause;
    }
    const diagnostic = createDiagnostic({
      severity: "error",
      code: `mdx.limit.${limit}`,
      message: cause.message,
      span: document.origin,
    });
    const diagnostics: readonly [Diagnostic] = Object.freeze([diagnostic]);
    return Object.freeze({
      kind: "limitExceeded",
      file: parsed.file,
      limit,
      diagnostics,
    });
  }
}

async function validateFrontmatter(
  file: SourceFile,
  document: DocumentNode,
  value: FrontmatterObject,
  schema: Schema | undefined,
): Promise<
  | Readonly<{ kind: "valid"; value: unknown }>
  | Extract<MdxCompileOutcome<never>, { kind: "invalid" }>
> {
  if (schema === undefined) {
    return Object.freeze({ kind: "valid", value });
  }
  const result = await schema["~standard"].validate(value);
  if (result.issues === undefined) {
    return Object.freeze({ kind: "valid", value: result.value });
  }
  const diagnostics = result.issues.map((issue) =>
    createDiagnostic({
      severity: "error",
      code: "mdx.frontmatter.schema",
      message: formatSchemaIssue(issue),
      span: document.frontmatter?.origin,
    }),
  );
  return invalidOutcome(file, diagnostics);
}

function formatSchemaIssue(issue: SchemaIssue): string {
  const path = issue.path
    ?.map((part) => String(typeof part === "object" ? part.key : part))
    .join(".");
  return path === undefined || path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}

type TransportFrontmatterResult =
  | Readonly<{ kind: "transportable"; value: MdxTransportValue }>
  | Readonly<{ kind: "unsupported"; reason: string }>;

function transportFrontmatter(value: unknown): TransportFrontmatterResult {
  return copyTransportValue(value, "frontmatter", new WeakSet<object>());
}

function copyTransportValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): TransportFrontmatterResult {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string"
  ) {
    return Object.freeze({ kind: "transportable", value });
  }
  if (value instanceof FrontmatterTemporal) {
    return Object.freeze({
      kind: "transportable",
      value: Object.freeze({ kind: value.kind, value: value.value }),
    });
  }
  if (typeof value !== "object") {
    return unsupportedTransport(`${path} contains unsupported ${typeof value}`);
  }
  if (ancestors.has(value)) {
    return unsupportedTransport(`${path} contains a cycle`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    const output: MdxTransportValue[] = [];
    for (let index = 0; index < value.length; index++) {
      const item = copyTransportValue(value[index], `${path}[${index}]`, ancestors);
      if (item.kind === "unsupported") {
        ancestors.delete(value);
        return item;
      }
      output.push(item.value);
    }
    ancestors.delete(value);
    return Object.freeze({ kind: "transportable", value: Object.freeze(output) });
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    ancestors.delete(value);
    return unsupportedTransport(`${path} contains a non-plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    ancestors.delete(value);
    return unsupportedTransport(`${path} contains a symbol property`);
  }
  const output: Record<string, MdxTransportValue> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) {
      continue;
    }
    if (!("value" in descriptor)) {
      ancestors.delete(value);
      return unsupportedTransport(`${path}.${key} is an accessor property`);
    }
    const item = copyTransportValue(descriptor.value, `${path}.${key}`, ancestors);
    if (item.kind === "unsupported") {
      ancestors.delete(value);
      return item;
    }
    output[key] = item.value;
  }
  ancestors.delete(value);
  return Object.freeze({ kind: "transportable", value: Object.freeze(output) });
}

function unsupportedTransport(reason: string): TransportFrontmatterResult {
  return Object.freeze({ kind: "unsupported", reason });
}

function invalidOutcome(
  file: SourceFile,
  diagnostics: readonly Diagnostic[],
): Extract<MdxCompileOutcome<never>, { kind: "invalid" }> {
  const first = diagnostics[0];
  if (first === undefined) {
    throw new Error("Invalid compilation outcome requires a diagnostic");
  }
  const nonEmpty: readonly [Diagnostic, ...Diagnostic[]] = Object.freeze([
    first,
    ...diagnostics.slice(1),
  ]);
  return Object.freeze({
    kind: "invalid",
    file,
    diagnostics: nonEmpty,
  });
}

function compilerLimit(error: CompileError): CompilerLimit | undefined {
  return error.issue.kind === "generatedCodeLimit"
    ? "maximumGeneratedCodeBytes"
    : error.issue.kind === "sourceMapLimit"
      ? "maximumSourceMapBytes"
      : undefined;
}

function emitModulePreamble(
  writer: CodeWriter,
  state: CompilerState,
  options: Readonly<CompileOptions>,
): void {
  for (const entry of state.esm) {
    writer.write(`${entry.code.trimEnd()}\n`, entry.span);
  }
  const importSource = options.jsxImportSource ?? "react";
  writer.write(
    state.development
      ? `import {Fragment as _Fragment, jsxDEV as _jsxDEV} from ${JSON.stringify(`${importSource}/jsx-dev-runtime`)};\n`
      : `import {Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs} from ${JSON.stringify(`${importSource}/jsx-runtime`)};\n`,
  );
  if (options.providerImportSource !== undefined) {
    writer.write(
      `import {useMDXComponents as _provideComponents} from ${JSON.stringify(options.providerImportSource)};\n`,
    );
  }
}

function emitContentFunction(
  writer: CodeWriter,
  document: DocumentNode,
  state: CompilerState,
  options: Readonly<CompileOptions>,
  usesAwait: boolean,
): void {
  writer.write(`${usesAwait ? "async " : ""}function _createContent(props) {\n`);
  writer.write("  const _components = {");
  const tags = [...state.intrinsicTags].sort();
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
    `${tags.length === 0 && options.providerImportSource === undefined ? "" : ", "}...props.components?.html};\n`,
  );

  const components = [...state.referencedComponents].sort();
  for (const component of components) {
    writer.write(
      `  const ${component} = props.components?.jsx?.[${JSON.stringify(component)}]?.component ?? _components[${JSON.stringify(component)}];\n`,
    );
  }
  for (const [reference, component] of state.missingReferences) {
    writer.write(
      `  if (!${reference}) _missingReference(${JSON.stringify(reference)}, ${component});\n`,
    );
  }
  writer.write("  return ");
  emitContent(writer, document, state);
  writer.write(";\n}\n");
}

function emitPublicComponent(
  writer: CodeWriter,
  state: CompilerState,
  options: Readonly<CompileOptions>,
  usesAwait: boolean,
): void {
  writer.write(`export default ${usesAwait ? "async " : ""}function Content(props = {}) {\n`);
  const content = `${usesAwait ? "await " : ""}_createContent(props)`;
  if (state.hasInternalLayout) {
    writer.write(`  return ${runtimeCall(state, "Layout", `{...props, children: ${content}}`)};\n`);
  } else {
    writer.write("  const {wrapper: Layout} = {");
    if (options.providerImportSource !== undefined) {
      writer.write("..._provideComponents(), ");
    }
    writer.write("...props.components?.html};\n");
    writer.write(
      `  return Layout ? ${runtimeCall(state, "Layout", `{...props, children: ${content}}`)} : ${content};\n`,
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

function enforceGeneratedCodeLimit(code: string, configuredMaximum: number | undefined): void {
  const maximum = configuredMaximum ?? defaultMaximumGeneratedCodeBytes;
  const actual = new TextEncoder().encode(code).byteLength;
  if (actual > maximum) {
    CompileError.generatedCodeLimitExceeded(actual, maximum);
  }
}

function enforceSourceMapLimit(map: SourceMap, configuredMaximum: number | undefined): void {
  const maximum = configuredMaximum ?? defaultMaximumSourceMapBytes;
  const actual = new TextEncoder().encode(JSON.stringify(map)).byteLength;
  if (actual > maximum) {
    CompileError.sourceMapLimitExceeded(actual, maximum);
  }
}

function runtimeCall(state: CompilerState, tag: string, properties: string): string {
  return state.development
    ? `_jsxDEV(${tag}, ${properties}, undefined, false, undefined, undefined)`
    : `_jsx(${tag}, ${properties})`;
}
