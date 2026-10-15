import type { Diagnostic } from "./diagnostics.ts";
import type { ParserLimit } from "./parser/config.ts";
import type { SourceFile } from "./source.ts";

/** Authored errors and exceeded limits are values. Every failure has an error diagnostic. */
export type MdxFailure<TLimit extends string = ParserLimit> =
  | Readonly<{
      kind: "invalid";
      file: SourceFile;
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>
  | Readonly<{
      kind: "limitExceeded";
      file: SourceFile;
      limit: TLimit;
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>;

/** The result of every parse, process, compile, and stream completion. */
export type MdxOutcome<TValue extends object, TLimit extends string = ParserLimit> =
  | (Readonly<{ kind: "ok"; file: SourceFile; diagnostics: readonly Diagnostic[] }> &
      Readonly<TValue>)
  | MdxFailure<TLimit>;

export function isOk<TOutcome extends { readonly kind: string }>(
  outcome: TOutcome,
): outcome is Extract<TOutcome, { readonly kind: "ok" }> {
  return outcome.kind === "ok";
}
