import type { Schema, SchemaIssue, SchemaOutput } from "@temelj/standard-schema";

import { isObject, isBoolean, isNumber, isBigInt, isString } from "@temelj/value";

import type { Diagnostic } from "./diagnostics.ts";
import type { HtmlRenderOptions } from "./html-lower.ts";
import type { HtmlRootNode } from "./html.ts";
import type { DocumentNode, FrontmatterObject, SourceRange } from "./model.ts";
import type { MdxFailure, ParseOutcome, ParserLimit } from "./parser.ts";
import type { SourceFile } from "./source.ts";

import { analyzeDocument, type CompileAnalysis } from "./compile-analysis.ts";
import { contentUsesAwait, emitContent } from "./compile-emit.ts";
import { createDiagnostic, hasErrorDiagnostics } from "./diagnostics.ts";
import { CompileError, ConfigurationError, MdxError } from "./errors.ts";
import { toFunctionBody } from "./function-body.ts";
import { lowerHtml } from "./html-lower.ts";
import { javascriptPropertyName } from "./javascript-ast.ts";
import { parseJavaScriptProgram } from "./javascript.ts";
import { documentFrontmatter, FrontmatterTemporal } from "./model.ts";
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

export type CompileLimit = ParserLimit | "maximumGeneratedCodeBytes" | "maximumSourceMapBytes";

export interface CompileSchemaOptions<TSchema extends Schema> extends CompileOptions {
  /** Standard Schema validation for decoded frontmatter. */
  readonly frontmatterSchema: TSchema;
}

export type CompileOutcome<TFrontmatter = FrontmatterObject> =
  | Readonly<{
      kind: "ok";
      file: SourceFile;
      document: DocumentNode;
      artifact: CompileArtifact;
      frontmatter: TFrontmatter;
      diagnostics: readonly Diagnostic[];
    }>
  | MdxFailure<CompileLimit>;

/** Emits JavaScript for a strict document. Throws for configuration errors and compiler limits. */
function emitArtifact(
  document: DocumentNode,
  options: Readonly<CompileOptions>,
  frontmatter: MdxTransportValue,
): CompileArtifact {
  try {
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

    const content = lowerHtml(document, options);
    const analysis = analyzeDocument(document, content, options);
    const usesAwait = contentUsesAwait(content);

    const writer = new CodeWriter(options.source);
    emitModulePreamble(writer, analysis, options);
    emitContentFunction(writer, content, analysis, options, usesAwait);
    emitPublicComponent(writer, analysis, options, usesAwait);

    if (analysis.scope.missingReferences.size > 0) {
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

    const map = writer.sourceMap(analysis.scope.sourceName, options.outputName);
    enforceSourceMapLimit(map, options.maximumSourceMapBytes);

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

/**
 * Validates frontmatter and compiles a parsed or transformed document to
 * JavaScript without executing it. Compiled content renders the same elements as
 * `lowerHtml`. A failed input outcome is returned unchanged.
 */
export function compile<TSchema extends Schema>(
  input: ParseOutcome,
  options: Readonly<CompileSchemaOptions<TSchema>>,
): Promise<CompileOutcome<SchemaOutput<TSchema>>>;
export function compile(
  input: ParseOutcome,
  options?: Readonly<CompileOptions>,
): Promise<CompileOutcome<FrontmatterObject>>;
export async function compile(
  input: ParseOutcome,
  options: Readonly<CompileOptions & { readonly frontmatterSchema?: Schema }> = {},
): Promise<CompileOutcome<unknown>> {
  if (input.kind !== "ok") {
    return input;
  }

  const parsed = input;
  const document = input.document;
  const transformedDiagnostics = input.diagnostics;

  if (hasErrorDiagnostics(transformedDiagnostics)) {
    return invalidOutcome(parsed.file, transformedDiagnostics);
  }

  const frontmatterNode = documentFrontmatter(document);
  const frontmatterInput = frontmatterNode?.data ?? Object.freeze({});

  const frontmatter = await validateFrontmatter(
    parsed.file,
    frontmatterNode?.origin,
    frontmatterInput,
    options.frontmatterSchema,
  );

  if (frontmatter.kind === "invalid") {
    return frontmatter;
  }

  try {
    const transportedFrontmatter = copyTransportValue(
      frontmatter.value,
      "frontmatter",
      new WeakSet<object>(),
    );

    if (transportedFrontmatter.kind === "unsupported") {
      const diagnostic = createDiagnostic({
        severity: "error",
        code: "mdx.frontmatter.transport",
        message: "Validated frontmatter must contain transportable values",
        notes: [transportedFrontmatter.reason],
        span: fileSpan(parsed.file, frontmatterNode?.origin),
      });

      return invalidOutcome(parsed.file, [diagnostic]);
    }

    const artifact = emitArtifact(
      document,
      { ...options, source: parsed.file },
      transportedFrontmatter.value,
    );

    return Object.freeze({
      kind: "ok",
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
      span: fileSpan(parsed.file, document.origin),
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
  origin: SourceRange | undefined,
  value: FrontmatterObject,
  schema: Schema | undefined,
): Promise<
  Readonly<{ kind: "valid"; value: unknown }> | Extract<CompileOutcome<never>, { kind: "invalid" }>
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
      span: fileSpan(file, origin),
    }),
  );

  return invalidOutcome(file, diagnostics);
}

function formatSchemaIssue(issue: SchemaIssue): string {
  const path = issue.path?.map((part) => String(isObject(part) ? part.key : part)).join(".");

  return path === undefined || path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}

type TransportFrontmatterResult =
  | Readonly<{ kind: "transportable"; value: MdxTransportValue }>
  | Readonly<{ kind: "unsupported"; reason: string }>;

function copyTransportValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Recursively validates external schema output against the MDX transport contract.
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): TransportFrontmatterResult {
  if (value === null || isBoolean(value) || isNumber(value) || isBigInt(value) || isString(value)) {
    return Object.freeze({ kind: "transportable", value });
  }

  if (value instanceof FrontmatterTemporal) {
    return Object.freeze({
      kind: "transportable",
      value: Object.freeze({ kind: value.kind, value: value.value }),
    });
  }

  if (!isObject(value)) {
    return unsupportedTransport(
      `${path} contains unsupported ${Object.prototype.toString.call(value)}`,
    );
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

function fileSpan(
  file: SourceFile,
  range: SourceRange | undefined,
): Readonly<{ file: SourceFile; start: number; end: number }> | undefined {
  return range === undefined ? undefined : { file, start: range.start, end: range.end };
}

function invalidOutcome(
  file: SourceFile,
  diagnostics: readonly Diagnostic[],
): Extract<CompileOutcome<never>, { kind: "invalid" }> {
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

function compilerLimit(error: CompileError): CompileLimit | undefined {
  return error.issue.kind === "generatedCodeLimit"
    ? "maximumGeneratedCodeBytes"
    : error.issue.kind === "sourceMapLimit"
      ? "maximumSourceMapBytes"
      : undefined;
}

function emitModulePreamble(
  writer: CodeWriter,
  analysis: CompileAnalysis,
  options: Readonly<CompileOptions>,
): void {
  for (const entry of analysis.esm) {
    writer.write(`${entry.code.trimEnd()}\n`, entry.origin);
  }

  const importSource = options.jsxImportSource ?? "react";
  writer.write(
    analysis.scope.development
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
    `${tags.length === 0 && options.providerImportSource === undefined ? "" : ", "}...props.registry?.html};\n`,
  );

  const components = [...analysis.scope.referencedComponents].sort();

  for (const component of components) {
    writer.write(
      `  const ${component} = props.registry?.jsx?.[${JSON.stringify(component)}]?.component ?? _components[${JSON.stringify(component)}];\n`,
    );
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
): void {
  writer.write(`export default ${usesAwait ? "async " : ""}function Content(props = {}) {\n`);
  const content = `${usesAwait ? "await " : ""}_createContent(props)`;

  if (analysis.hasInternalLayout) {
    writer.write(
      `  return ${runtimeCall(analysis, "Layout", `{...props, children: ${content}}`)};\n`,
    );
  } else {
    writer.write("  const {wrapper: Layout} = {");

    if (options.providerImportSource !== undefined) {
      writer.write("..._provideComponents(), ");
    }

    writer.write("...props.registry?.html};\n");
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

function runtimeCall(analysis: CompileAnalysis, tag: string, properties: string): string {
  return analysis.scope.development
    ? `_jsxDEV(${tag}, ${properties}, undefined, false, undefined, undefined)`
    : `_jsx(${tag}, ${properties})`;
}
