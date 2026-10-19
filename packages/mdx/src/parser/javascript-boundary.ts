import { isObject, isNumber } from "@temelj/value";

import {
  hasJavaScriptToken,
  parseJavaScriptExpression,
  parseJavaScriptProgram,
} from "../javascript.ts";
import { JavaScriptScanner, type JavaScriptScannerState } from "./javascript-scanner.ts";

export type EmbeddedJavaScriptKind = "expression" | "jsxExpression" | "esm";

export type JavaScriptBoundaryResult =
  | Readonly<{ kind: "valid" }>
  | Readonly<{
      kind: "incompleteAtPhysicalEof";
      offset: number;
      state: JavaScriptScannerState;
    }>
  | Readonly<{ kind: "invalid"; offset: number }>;

export function parseJavaScriptBoundary(
  kind: EmbeddedJavaScriptKind,
  source: string,
  sourceOffset = 0,
): JavaScriptBoundaryResult {
  try {
    const node =
      kind === "esm" ? parseJavaScriptProgram(source) : parseJavaScriptExpression(source);

    if (kind !== "esm" && hasJavaScriptToken(source.slice(node.end))) {
      return { kind: "invalid", offset: sourceOffset + node.end };
    }

    return { kind: "valid" };
  } catch (cause) {
    const offset = acornFailureOffset(cause);
    const scanner = new JavaScriptScanner();
    const scanned = scanner.append(source);

    if (scanned.kind === "invalid") {
      return { kind: "invalid", offset: sourceOffset + scanned.offset };
    }

    if (scanner.incomplete || offset >= source.length) {
      return {
        kind: "incompleteAtPhysicalEof",
        offset: sourceOffset + source.length,
        state: scanner.state,
      };
    }

    return { kind: "invalid", offset: sourceOffset + offset };
  }
}

function acornFailureOffset(cause: unknown): number {
  if (!isObject(cause) || !("pos" in cause)) {
    throw cause;
  }

  const position = cause.pos;

  if (!isNumber(position)) {
    throw cause;
  }

  const raisedAt = "raisedAt" in cause ? cause.raisedAt : undefined;

  return isNumber(raisedAt) ? Math.max(position, raisedAt) : position;
}
