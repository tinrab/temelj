import { isPlainObject } from "@temelj/value";
import { parse as parseToml, TomlDate, TomlError } from "smol-toml";
import { parseDocument } from "yaml";

import type { DiagnosticReporter } from "./diagnostics.ts";
import type { FrontmatterObject, FrontmatterValue, SourceSpan } from "./model.ts";
import type { FrontmatterFormat } from "./syntax-options.ts";

import { FrontmatterTemporal } from "./model.ts";
import { lineStartOffsets } from "./utility.ts";

interface DecodeOptions {
  readonly diagnostics: DiagnosticReporter;
  readonly format: FrontmatterFormat;
  readonly source: string;
  readonly span: SourceSpan;
}

const maximumYamlAliases = 100;
const maximumTomlDepth = 256;

export function decodeFrontmatter(options: DecodeOptions): FrontmatterObject | undefined {
  return options.format === "yaml" ? decodeYaml(options) : decodeToml(options);
}

function decodeYaml(options: DecodeOptions): FrontmatterObject | undefined {
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(options.source, {
      customTags: [],
      intAsBigInt: true,
      logLevel: "silent",
      prettyErrors: false,
      resolveKnownTags: false,
      schema: "core",
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
      version: "1.2",
    });
  } catch (cause) {
    addParserFailure(options, cause);
    return undefined;
  }

  for (const warning of document.warnings) {
    options.diagnostics.add({
      code: yamlCode(warning.code),
      message: warning.message,
      severity: "warning",
      span: relativeSpan(options.span, warning.pos[0], warning.pos[1]),
    });
  }
  for (const error of document.errors) {
    options.diagnostics.add({
      code: yamlCode(error.code),
      message: error.message,
      severity: "error",
      span: relativeSpan(options.span, error.pos[0], error.pos[1]),
    });
  }
  if (document.errors.length > 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = document.contents === null ? {} : document.toJS({ maxAliasCount: maximumYamlAliases });
  } catch (cause) {
    addParserFailure(options, cause);
    return undefined;
  }
  return convertRoot(parsed, options);
}

function decodeToml(options: DecodeOptions): FrontmatterObject | undefined {
  let parsed: unknown;
  try {
    parsed = parseToml(options.source, {
      integersAsBigInt: "asNeeded",
      maxDepth: maximumTomlDepth,
    });
  } catch (cause) {
    if (cause instanceof TomlError) {
      const offset = lineColumnOffset(options.source, cause.line, cause.column);
      options.diagnostics.add({
        code: "mdx.frontmatter.toml",
        message: cause.message,
        severity: "error",
        span: relativeSpan(options.span, offset, offset + 1),
      });
    } else {
      addParserFailure(options, cause);
    }
    return undefined;
  }
  return convertRoot(parsed, options);
}

function convertRoot(value: unknown, options: DecodeOptions): FrontmatterObject | undefined {
  if (!isPlainObject(value)) {
    options.diagnostics.add({
      code: "mdx.frontmatter.root",
      message: "FrontmatterNode must contain a mapping at its root",
      severity: "error",
      span: options.span,
    });
    return undefined;
  }
  return convertObject(value, options, "$", new WeakSet<object>());
}

function convertValue(
  value: unknown,
  options: DecodeOptions,
  path: string,
  active: WeakSet<object>,
): FrontmatterValue | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value;
  }
  if (value instanceof TomlDate) {
    return convertTemporal(value);
  }
  if (Array.isArray(value)) {
    if (active.has(value)) {
      return invalidValue(options, path, "cyclic alias");
    }
    active.add(value);
    const converted: FrontmatterValue[] = [];
    for (const [index, item] of value.entries()) {
      const result = convertValue(item, options, `${path}[${index}]`, active);
      if (result === undefined) {
        return undefined;
      }
      converted.push(result);
    }
    active.delete(value);
    Object.freeze(converted);
    return converted;
  }
  if (isPlainObject(value)) {
    return convertObject(value, options, path, active);
  }
  return invalidValue(options, path, describeValue(value));
}

function convertObject(
  value: Record<string, unknown>,
  options: DecodeOptions,
  path: string,
  active: WeakSet<object>,
): FrontmatterObject | undefined {
  if (active.has(value)) {
    return invalidValue(options, path, "cyclic alias");
  }
  active.add(value);
  const converted: Record<string, FrontmatterValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const itemPath = propertyPath(path, key);
    const result = convertValue(item, options, itemPath, active);
    if (result === undefined) {
      return undefined;
    }
    Object.defineProperty(converted, key, {
      configurable: false,
      enumerable: true,
      value: result,
      writable: false,
    });
  }
  active.delete(value);
  Object.freeze(converted);
  return converted;
}

function convertTemporal(value: TomlDate): FrontmatterTemporal {
  if (value.isDateTime()) {
    return new FrontmatterTemporal(
      value.isLocal() ? "local-date-time" : "offset-date-time",
      value.toISOString(),
    );
  }
  if (value.isDate()) {
    return new FrontmatterTemporal("local-date", value.toISOString());
  }
  return new FrontmatterTemporal("local-time", value.toISOString());
}

function invalidValue(options: DecodeOptions, path: string, description: string): undefined {
  options.diagnostics.add({
    code: "mdx.frontmatter.value",
    message: `Unsupported frontmatter value at ${path}: ${description}`,
    severity: "error",
    span: options.span,
  });
  return undefined;
}

function addParserFailure(options: DecodeOptions, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  options.diagnostics.add({
    code: `mdx.frontmatter.${options.format}`,
    message,
    severity: "error",
    span: options.span,
  });
}

function yamlCode(code: string): string {
  return code === "RESOURCE_EXHAUSTION" ? "mdx.frontmatter.resource" : "mdx.frontmatter.yaml";
}

function relativeSpan(span: SourceSpan, start: number, end: number): SourceSpan {
  const length = span.end - span.start;
  const relativeStart = Math.max(0, Math.min(start, length));
  const relativeEnd = Math.max(relativeStart, Math.min(end, length));
  return Object.freeze({
    file: span.file,
    start: span.start + relativeStart,
    end: span.start + relativeEnd,
  });
}

function lineColumnOffset(source: string, line: number, column: number): number {
  const lineStart = lineStartOffsets(source)[Math.max(0, line - 1)] ?? source.length;
  return Math.min(source.length, lineStart + Math.max(0, column - 1));
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "function") {
    return "function";
  }
  if (typeof value === "symbol") {
    return "symbol";
  }
  if (value instanceof Map) {
    return "Map";
  }
  if (value instanceof Set) {
    return "Set";
  }
  if (value instanceof Date) {
    return "Date";
  }
  return typeof value === "object" && value !== null
    ? (value.constructor?.name ?? "object")
    : typeof value;
}
