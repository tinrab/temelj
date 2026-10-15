import type { SourceText } from "../source-text.ts";
import type { InlineInput } from "./inline-input.ts";
import type { InlineMatch } from "./inline-output.ts";
import type { InlineDirectiveAttribute, InlineSyntax } from "./inline-syntax.ts";

import { parseDirectiveAttributes } from "./directive-attributes.ts";
import { findUnescapedInline, textNode } from "./inline-output.ts";

// Text directives.

export function inlineDirective(
  input: InlineInput,
  value: SourceText,
  start: number,
): InlineMatch | undefined {
  if (value.char(start + 1) === ":") {
    return;
  }

  const name = /^[A-Za-z][\w-]*/u.exec(value.slice(start + 1))?.[0];

  if (name === undefined) {
    return;
  }

  let cursor = start + 1 + name.length;
  let label: readonly InlineSyntax[] = [];

  if (value.char(cursor) === "[") {
    const close = findUnescapedInline(value, "]", cursor + 1);

    if (close === undefined) {
      return;
    }

    label = [textNode(input, value, cursor + 1, close)];
    cursor = close + 1;
  }

  let attributes: readonly InlineDirectiveAttribute[] = [];

  if (value.char(cursor) === "{") {
    const close = findUnescapedInline(value, "}", cursor + 1);

    if (close === undefined) {
      return;
    }

    attributes = parseDirectiveAttributes(value.slice(cursor + 1, close));
    cursor = close + 1;
  }

  if (label.length === 0 && attributes.length === 0) {
    return;
  }

  return {
    end: cursor,
    node: {
      kind: "directive",
      range: input.sourceRange(start, cursor),
      name,
      label,
      attributes,
    },
  };
}

/** A directive whose label or attributes later input could still close. */
export function directiveUnfinished(value: SourceText, start: number): boolean {
  const name = /^[A-Za-z][\w-]*/u.exec(value.slice(start + 1))?.[0];

  if (name === undefined || value.char(start + 1) === ":") {
    return false;
  }

  const cursor = start + 1 + name.length;

  return (
    (value.char(cursor) === "[" && findUnescapedInline(value, "]", cursor + 1) === undefined) ||
    (value.char(cursor) === "{" && findUnescapedInline(value, "}", cursor + 1) === undefined) ||
    cursor === value.length
  );
}
