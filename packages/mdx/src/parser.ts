import type { Diagnostic } from "./diagnostics.ts";
import type { DocumentNode } from "./model.ts";
import type { ParserLimits } from "./parser/config.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

import { LimitError, ParseError } from "./errors.ts";
import { BlockParser } from "./parser/block-parser.ts";
import { resolveParserLimits } from "./parser/config.ts";
import { materializeDocument } from "./parser/materialize.ts";
import { PhysicalLineScanner, SourceFile, sourceText } from "./source.ts";
import { resolveSyntaxOptions } from "./syntax-options.ts";

export { defaultParserLimits, type ParserLimit, type ParserLimits } from "./parser/config.ts";

export interface ParseOptions {
  readonly limits?: ParserLimits;
  readonly syntax?: SyntaxOptions;
}

export interface ParseResult {
  readonly file: SourceFile;
  readonly document: DocumentNode;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parses a complete document with the shared block and inline grammar.
 * @throws {ParseError} Invalid authored syntax.
 * @throws {LimitError} An exceeded parser limit.
 * @throws {ConfigurationError} Invalid parser options.
 */
export function parse(input: string | SourceFile, options: ParseOptions = {}): ParseResult {
  const file = input instanceof SourceFile ? input : new SourceFile(input);
  const limits = resolveParserLimits(options.limits);

  if (file.length > limits.maximumSourceLength) {
    throw LimitError.exceeded(
      file,
      "maximumSourceLength",
      limits.maximumSourceLength,
      undefined,
      file.length,
    );
  }

  const syntax = resolveSyntaxOptions(options.syntax);
  const text = file.text;
  const source = sourceText(file).flatten().grammar();
  const scanner = new PhysicalLineScanner();
  const parser = new BlockParser(syntax);

  for (const line of scanner.append(text)) {
    parser.write(source, line);
  }

  for (const line of scanner.complete()) {
    parser.write(source, line);
  }

  const materialized = materializeDocument(file, parser.finish(source), syntax, limits);

  if (materialized.kind === "ok") {
    return Object.freeze({
      file,
      document: materialized.document,
      diagnostics: materialized.diagnostics,
    });
  }

  if (materialized.kind === "invalid") {
    throw ParseError.invalidSyntax(file, materialized.diagnostics);
  }

  throw LimitError.exceeded(file, materialized.limit, limits[materialized.limit]);
}
