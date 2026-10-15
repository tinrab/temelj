import type { SourceText } from "../source-text.ts";
import type { InlineInput } from "./inline-input.ts";
import type { InlineSyntax } from "./inline-syntax.ts";

import { sourceRange } from "../ranges.ts";

// The inline parser's output sequence: parsed nodes, delimiter runs, and brackets.

export interface Delimiter {
  readonly canClose: boolean;
  readonly canOpen: boolean;
  readonly marker: "*" | "_" | "~";
  readonly originalLength: number;
  length: number;
  start: number;
}

export interface Bracket {
  active: boolean;
  readonly image: boolean;
  readonly start: number;
}

export type Output = InlineSyntax | Delimiter | Bracket;

export interface InlineMatch {
  readonly end: number;
  readonly node: InlineSyntax;
}

export function convertOutput(input: InlineInput, output: readonly Output[]): InlineSyntax[] {
  return mergeText(
    output.map((entry) =>
      isDelimiter(entry)
        ? delimiterText(input, entry)
        : isBracket(entry)
          ? bracketText(input, entry)
          : entry,
    ),
  );
}

export function findUnescapedInline(
  value: SourceText,
  target: string,
  start: number,
): number | undefined {
  for (let offset = start; offset < value.length; offset++) {
    if (value.char(offset) === target && !escapedAt(value, offset, start)) {
      return offset;
    }
  }

  return;
}

export function escapedAt(value: SourceText, offset: number, lowerBound: number): boolean {
  let slashes = 0;

  for (let index = offset - 1; index >= lowerBound && value.char(index) === "\\"; index--) {
    slashes++;
  }

  return slashes % 2 === 1;
}

export function textNode(
  input: InlineInput,
  value: SourceText,
  start: number,
  end: number,
): InlineSyntax {
  return {
    kind: "text",
    range: input.sourceRange(start, end),
    value: value.slice(start, end),
  };
}

export function delimiterText(input: InlineInput, delimiter: Delimiter): InlineSyntax {
  return {
    kind: "text",
    range: input.sourceRange(delimiter.start, delimiter.start + delimiter.length),
    value: delimiter.marker.repeat(delimiter.length),
  };
}

export function bracketText(input: InlineInput, bracket: Bracket): InlineSyntax {
  const end = bracket.start + (bracket.image ? 2 : 1);

  return {
    kind: "text",
    range: input.sourceRange(bracket.start, end),
    value: bracket.image ? "![" : "[",
  };
}

export function isDelimiter(output: Output): output is Delimiter {
  return "marker" in output;
}

export function isBracket(output: Output): output is Bracket {
  return "active" in output;
}

export function markerRunEnd(value: SourceText, start: number, marker: string): number {
  let end = start;

  while (value.char(end) === marker) {
    end++;
  }

  return end;
}

export function mergeText(nodes: readonly InlineSyntax[]): InlineSyntax[] {
  const merged: InlineSyntax[] = [];

  for (const node of nodes) {
    const previous = merged.at(-1);

    if (
      previous?.kind === "text" &&
      node.kind === "text" &&
      previous.range.end === node.range.start
    ) {
      merged[merged.length - 1] = {
        kind: "text",
        range: sourceRange(previous.range.start, node.range.end),
        value: previous.value + node.value,
      };
    } else {
      merged.push(node);
    }
  }

  return merged;
}
