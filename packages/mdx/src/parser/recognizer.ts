import type { Diagnostic } from "../diagnostics.ts";

export type RecognizerResult<TMatch> =
  | Readonly<{ kind: "noMatch" }>
  | Readonly<{ kind: "matched"; value: TMatch }>
  | Readonly<{ kind: "incompleteAtEof"; expected: string }>
  | Readonly<{ kind: "invalid"; diagnostics: readonly [Diagnostic, ...Diagnostic[]] }>;

export const noMatch: RecognizerResult<never> = { kind: "noMatch" };

export function matched<TMatch>(value: TMatch): RecognizerResult<TMatch> {
  return { kind: "matched", value };
}

export function incompleteAtEof(expected: string): RecognizerResult<never> {
  return { kind: "incompleteAtEof", expected };
}

export function invalid(
  diagnostics: readonly [Diagnostic, ...Diagnostic[]],
): RecognizerResult<never> {
  return { kind: "invalid", diagnostics };
}
