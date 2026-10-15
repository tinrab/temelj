import type { Diagnostic } from "./diagnostics.ts";
import type { DocumentNode } from "./model.ts";
import type { ParserLimits } from "./parser/config.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

import { LimitError, ParseError } from "./errors.ts";
import { resolveParserLimits } from "./parser/config.ts";
import { materializeDocument } from "./parser/materialize.ts";
import { ParserSession } from "./parser/session.ts";
import { SourceFile } from "./source.ts";

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
 * Strict parsing is terminal completion of the incremental parser session.
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

  const session = new ParserSession({ source: file, syntax: options.syntax, limits });
  const draft = session.completeDraft();

  const materialized = materializeDocument(
    draft.file,
    draft.blocks,
    session.syntax,
    session.limits,
  );

  if (materialized.kind === "ok") {
    return Object.freeze({
      file: draft.file,
      document: materialized.document,
      diagnostics: materialized.diagnostics,
    });
  }

  if (materialized.kind === "invalid") {
    throw ParseError.invalidSyntax(draft.file, materialized.diagnostics);
  }

  throw LimitError.exceeded(draft.file, materialized.limit, limits[materialized.limit]);
}
