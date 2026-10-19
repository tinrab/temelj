import type { Schema, SchemaOutput } from "@temelj/standard-schema";

import { StandardSchemaAsyncValidationError } from "@temelj/standard-schema";
import { isPromise } from "@temelj/value";

import type { Diagnostic } from "./diagnostics.ts";
import type { FrontmatterObject } from "./model.ts";
import type { ParserLimits } from "./parser/config.ts";
import type { SourceRange } from "./ranges.ts";
import type { SourceText } from "./source-text.ts";
import type { FrontmatterFormat, FrontmatterMode } from "./syntax-options.ts";

import { DiagnosticBag } from "./diagnostics.ts";
import { LimitError, ParseError } from "./errors.ts";
import { decodeFrontmatter } from "./frontmatter-decode.ts";
import { frontmatterSchemaValue } from "./frontmatter-schema.ts";
import { resolveParserLimits } from "./parser/config.ts";
import { SourceFile, sourceText } from "./source.ts";

export interface FrontmatterParseOptions {
  /** Formats to recognize. Defaults to both YAML and TOML. */
  readonly format?: FrontmatterMode;
  /** Limits the entire input length in UTF-16 code units, without scanning its body. */
  readonly limits?: Pick<ParserLimits, "maximumSourceLength">;
}

export interface FrontmatterParseSchemaOptions<
  TSchema extends Schema,
> extends FrontmatterParseOptions {
  readonly frontmatterSchema: TSchema;
}

export interface FrontmatterParseResult<T = FrontmatterObject> {
  readonly file: SourceFile;
  readonly frontmatter: T;
  /** Undefined when no complete, enabled frontmatter block was found. */
  readonly format: FrontmatterFormat | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Reads only the opening frontmatter block and optionally validates its metadata.
 * @throws {ParseError} Invalid YAML or TOML.
 * @throws {FrontmatterError} Schema validation fails.
 * @throws {LimitError | ConfigurationError} Invalid or exceeded source-length limit.
 */
export function parseFrontmatter<TSchema extends Schema>(
  input: string | SourceFile,
  options: FrontmatterParseSchemaOptions<TSchema>,
): Promise<FrontmatterParseResult<SchemaOutput<TSchema>>>;
export function parseFrontmatter(
  input: string | SourceFile,
  options?: FrontmatterParseOptions,
): Promise<FrontmatterParseResult>;
export async function parseFrontmatter(
  input: string | SourceFile,
  options: FrontmatterParseOptions & { readonly frontmatterSchema?: Schema } = {},
): Promise<FrontmatterParseResult<unknown>> {
  const { result, origin } = readFrontmatter(input, options);

  if (options.frontmatterSchema === undefined) {
    return result;
  }

  const validated = await options.frontmatterSchema["~standard"].validate(result.frontmatter);

  return Object.freeze({
    ...result,
    frontmatter: frontmatterSchemaValue(validated, result.file, origin),
  });
}

/**
 * Reads frontmatter synchronously, including synchronous schema validation.
 * @throws {StandardSchemaAsyncValidationError} The schema returns a promise.
 * @throws {ParseError | FrontmatterError | LimitError | ConfigurationError} Parsing fails.
 */
export function parseFrontmatterSync<TSchema extends Schema>(
  input: string | SourceFile,
  options: FrontmatterParseSchemaOptions<TSchema>,
): FrontmatterParseResult<SchemaOutput<TSchema>>;
export function parseFrontmatterSync(
  input: string | SourceFile,
  options?: FrontmatterParseOptions,
): FrontmatterParseResult;
export function parseFrontmatterSync(
  input: string | SourceFile,
  options: FrontmatterParseOptions & { readonly frontmatterSchema?: Schema } = {},
): FrontmatterParseResult<unknown> {
  const { result, origin } = readFrontmatter(input, options);

  if (options.frontmatterSchema === undefined) {
    return result;
  }

  const validated = options.frontmatterSchema["~standard"].validate(result.frontmatter);

  if (isPromise(validated)) {
    StandardSchemaAsyncValidationError.unsupported();
  }

  return Object.freeze({
    ...result,
    frontmatter: frontmatterSchemaValue(validated, result.file, origin),
  });
}

interface ReadFrontmatterResult {
  readonly result: FrontmatterParseResult;
  readonly origin: SourceRange | undefined;
}

function readFrontmatter(
  input: string | SourceFile,
  options: FrontmatterParseOptions,
): ReadFrontmatterResult {
  const file = input instanceof SourceFile ? input : new SourceFile(input);
  const { maximumSourceLength } = resolveParserLimits(options.limits);

  if (file.length > maximumSourceLength) {
    throw LimitError.exceeded(
      file,
      "maximumSourceLength",
      maximumSourceLength,
      undefined,
      file.length,
    );
  }

  const source = sourceText(file);
  const opening = readLine(source, 0);
  const fence = source.slice(0, opening.contentEnd).trim();
  const format = fence === "---" ? "yaml" : fence === "+++" ? "toml" : undefined;

  if (
    format !== undefined &&
    (options.format === undefined || options.format === "auto" || options.format === format)
  ) {
    const valueStart = opening.end;

    for (let start = valueStart; start < source.length;) {
      const line = readLine(source, start);

      if (source.slice(start, line.contentEnd).trim() === fence) {
        let valueEnd = start;

        if (valueEnd > valueStart && source.char(valueEnd - 1) === "\n") {
          valueEnd--;
        }

        if (valueEnd > valueStart && source.char(valueEnd - 1) === "\r") {
          valueEnd--;
        }

        const diagnostics = new DiagnosticBag();

        const frontmatter = decodeFrontmatter({
          diagnostics,
          format,
          source: source.slice(valueStart, valueEnd),
          span: { file, start: valueStart, end: valueEnd },
        });

        if (frontmatter === undefined) {
          const [first, ...rest] = diagnostics
            .snapshot()
            .filter((diagnostic) => diagnostic.severity === "error");

          if (first === undefined) {
            throw new Error("Invalid frontmatter did not produce an error diagnostic");
          }

          throw ParseError.invalidSyntax(file, [first, ...rest]);
        }

        return {
          result: Object.freeze({ file, frontmatter, format, diagnostics: diagnostics.snapshot() }),
          origin: { start: source.char(0) === "\uFEFF" ? 1 : 0, end: line.end },
        };
      }

      start = line.end;
    }
  }

  return {
    result: Object.freeze({
      file,
      frontmatter: Object.freeze({}),
      format: undefined,
      diagnostics: Object.freeze([]),
    }),
    origin: undefined,
  };
}

interface FrontmatterLine {
  readonly contentEnd: number;
  readonly end: number;
}

/** Reads one physical line without indexing or normalizing the rest of the document. */
function readLine(source: SourceText, start: number): FrontmatterLine {
  let end = start;

  while (end < source.length) {
    const character = source.char(end);

    if (character === "\n" || character === "\r") {
      const endingLength = character === "\r" && source.char(end + 1) === "\n" ? 2 : 1;

      return { contentEnd: end, end: end + endingLength };
    }

    end++;
  }

  return { contentEnd: end, end };
}
