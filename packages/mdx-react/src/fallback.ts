import type { Diagnostic } from "@temelj/mdx";
import type React from "react";

import { isFunction } from "@temelj/value";

export type DiagnosticFallback =
  | React.ReactNode
  | ((diagnostics: readonly Diagnostic[]) => React.ReactNode);

export function renderFallback(
  fallback: DiagnosticFallback | undefined,
  diagnostics: readonly Diagnostic[],
): React.ReactNode {
  return isFunction(fallback) ? fallback(diagnostics) : (fallback ?? null);
}
