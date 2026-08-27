import type { Node, Options } from "acorn";

import { Parser } from "acorn";
import acornJsx from "acorn-jsx";

export type EmbeddedJavaScriptKind = "expression" | "jsxExpression" | "jsxSpread" | "esm";

export type JavaScriptScannerState =
  | "code"
  | "singleQuotedString"
  | "doubleQuotedString"
  | "template"
  | "lineComment"
  | "blockComment";

export type JavaScriptBoundaryResult =
  | Readonly<{ kind: "valid"; boundary: JavaScriptBoundary }>
  | Readonly<{
      kind: "incompleteAtPhysicalEof";
      offset: number;
      state: JavaScriptScannerState;
    }>
  | Readonly<{ kind: "invalid"; offset: number }>;

const JavaScriptParser = Parser.extend(acornJsx());
const options: Options = { ecmaVersion: "latest", sourceType: "module" };

/** A parsed embedded range. Its Acorn node never crosses the parser boundary. */
export class JavaScriptBoundary {
  readonly #node: Node;
  public readonly end: number;
  public readonly kind: EmbeddedJavaScriptKind;
  public readonly start: number;

  private constructor(kind: EmbeddedJavaScriptKind, node: Node, sourceOffset: number) {
    this.kind = kind;
    this.start = sourceOffset + node.start;
    this.end = sourceOffset + node.end;
    this.#node = node;
  }

  public static parsed(
    kind: EmbeddedJavaScriptKind,
    node: Node,
    sourceOffset = 0,
  ): JavaScriptBoundary {
    return new JavaScriptBoundary(kind, node, sourceOffset);
  }

  public includesAwait(): boolean {
    return nodeIncludesAwait(this.#node);
  }
}

export function parseJavaScriptBoundary(
  kind: EmbeddedJavaScriptKind,
  source: string,
  sourceOffset = 0,
): JavaScriptBoundaryResult {
  const scanner = scanJavaScript(source);
  if (scanner.invalidOffset !== undefined) {
    return { kind: "invalid", offset: sourceOffset + scanner.invalidOffset };
  }
  try {
    const node =
      kind === "esm"
        ? JavaScriptParser.parse(source, options)
        : JavaScriptParser.parseExpressionAt(source, 0, options);
    if (kind !== "esm" && hasTrailingToken(source, node.end)) {
      return { kind: "invalid", offset: sourceOffset + node.end };
    }
    return {
      kind: "valid",
      boundary: JavaScriptBoundary.parsed(kind, node, sourceOffset),
    };
  } catch (cause) {
    const offset = acornFailureOffset(cause);
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

interface ScanResult {
  readonly incomplete: boolean;
  readonly invalidOffset: number | undefined;
  readonly state: JavaScriptScannerState;
}

interface Delimiter {
  readonly character: ")" | "]" | "}";
  readonly resumesTemplate: boolean;
}

function scanJavaScript(source: string): ScanResult {
  const delimiters: Delimiter[] = [];
  let state: JavaScriptScannerState = "code";
  let escaped = false;
  let invalidOffset: number | undefined;
  for (let offset = 0; offset < source.length; offset++) {
    const character = source[offset];
    const next = source[offset + 1];
    if (state === "lineComment") {
      if (character === "\n" || character === "\r") {
        state = "code";
      }
      continue;
    }
    if (state === "blockComment") {
      if (character === "*" && next === "/") {
        state = "code";
        offset++;
      }
      continue;
    }
    if (state === "singleQuotedString" || state === "doubleQuotedString") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "singleQuotedString" && character === "'") ||
        (state === "doubleQuotedString" && character === '"')
      ) {
        state = "code";
      }
      continue;
    }
    if (state === "template") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "`") {
        state = "code";
      } else if (character === "$" && next === "{") {
        delimiters.push({ character: "}", resumesTemplate: true });
        state = "code";
        offset++;
      }
      continue;
    }

    if (character === "/" && next === "/") {
      state = "lineComment";
      offset++;
    } else if (character === "/" && next === "*") {
      state = "blockComment";
      offset++;
    } else if (character === "'") {
      state = "singleQuotedString";
    } else if (character === '"') {
      state = "doubleQuotedString";
    } else if (character === "`") {
      state = "template";
    } else if (character === "(") {
      delimiters.push({ character: ")", resumesTemplate: false });
    } else if (character === "[") {
      delimiters.push({ character: "]", resumesTemplate: false });
    } else if (character === "{") {
      delimiters.push({ character: "}", resumesTemplate: false });
    } else if (character === ")" || character === "]" || character === "}") {
      const delimiter = delimiters.at(-1);
      if (delimiter?.character === character) {
        delimiters.pop();
        if (delimiter.resumesTemplate) {
          state = "template";
        }
      } else {
        invalidOffset ??= offset;
      }
    }
  }
  if (state === "lineComment") {
    state = "code";
  }
  return {
    incomplete: state !== "code" || delimiters.length > 0,
    invalidOffset,
    state,
  };
}

function hasTrailingToken(source: string, offset: number): boolean {
  return JavaScriptParser.tokenizer(source.slice(offset), options).getToken().type.label !== "eof";
}

function acornFailureOffset(cause: unknown): number {
  if (typeof cause !== "object" || cause === null) {
    throw cause;
  }
  const position: unknown = Reflect.get(cause, "pos");
  if (typeof position !== "number") {
    throw cause;
  }
  const raisedAt: unknown = Reflect.get(cause, "raisedAt");
  return typeof raisedAt === "number" ? Math.max(position, raisedAt) : position;
}

function nodeIncludesAwait(node: Node): boolean {
  if (node.type === "AwaitExpression") {
    return true;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (value.some((entry: unknown) => isNode(entry) && nodeIncludesAwait(entry))) {
        return true;
      }
    } else if (isNode(value) && nodeIncludesAwait(value)) {
      return true;
    }
  }
  return false;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "type") === "string" &&
    typeof Reflect.get(value, "start") === "number" &&
    typeof Reflect.get(value, "end") === "number"
  );
}
