import type { Diagnostic } from "./diagnostics.ts";
import type { DocumentNode } from "./model.ts";
import type { MdxOutcome } from "./outcome.ts";
import type { ParserLimits } from "./parser/config.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

import { createDiagnostic } from "./diagnostics.ts";
import { resolveParserLimits } from "./parser/config.ts";
import { materializeDocument } from "./parser/materialize.ts";
import { ParserSession } from "./parser/session.ts";
import { SourceFile } from "./source.ts";

export { defaultParserLimits, type ParserLimit, type ParserLimits } from "./parser/config.ts";

export interface ParseOptions {
  readonly limits?: ParserLimits;
  readonly syntax?: SyntaxOptions;
}

export type ParseOutcome = MdxOutcome<{ document: DocumentNode }>;

/** Strict parsing is terminal completion of the incremental parser session. */
export function parse(input: string | SourceFile, options: ParseOptions = {}): ParseOutcome {
  const file = input instanceof SourceFile ? input : new SourceFile(input);
  const limits = resolveParserLimits(options.limits);

  if (file.length > limits.maximumSourceLength) {
    const diagnostic = createDiagnostic({
      code: "mdx.limit.maximumSourceLength",
      message: "Parser limit maximumSourceLength exceeded",
      severity: "error",
      span: { file, start: 0, end: file.length },
    });

    const diagnostics: readonly [Diagnostic] = Object.freeze([diagnostic]);

    return Object.freeze({
      kind: "limitExceeded",
      file,
      limit: "maximumSourceLength",
      diagnostics,
    });
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
      kind: "ok",
      file: draft.file,
      document: materialized.document,
      diagnostics: materialized.diagnostics,
    });
  }

  return materialized.kind === "invalid"
    ? Object.freeze({ kind: "invalid", file: draft.file, diagnostics: materialized.diagnostics })
    : Object.freeze({
        kind: "limitExceeded",
        file: draft.file,
        limit: materialized.limit,
        diagnostics: materialized.diagnostics,
      });
}
