import type { SourceText } from "../source-text.ts";
import type { InlineInput } from "./inline-input.ts";
import type { InlineMatch } from "./inline-output.ts";

import { isUnicodeWhitespace } from "./characters.ts";
import { escapedAt } from "./inline-output.ts";

// Inline TeX and dollar math.

export function texMath(
  input: InlineInput,
  value: SourceText,
  start: number,
): InlineMatch | undefined {
  let close = value.indexOf("\\)", start + 2);

  while (close !== -1 && escapedAt(value, close, start + 2)) {
    close = value.indexOf("\\)", close + 2);
  }

  if (close === -1) {
    return;
  }

  const end = close + 2;

  return {
    end,
    node: {
      kind: "math",
      range: input.sourceRange(start, end),
      value: value.slice(start + 2, close),
      format: "tex",
    },
  };
}

export function dollarMath(
  input: InlineInput,
  value: SourceText,
  start: number,
): InlineMatch | undefined {
  if (value.char(start + 1) === undefined || isUnicodeWhitespace(value.char(start + 1) ?? "")) {
    return;
  }

  let close = value.indexOf("$", start + 1);

  while (close !== -1 && escapedAt(value, close, start + 1)) {
    close = value.indexOf("$", close + 1);
  }

  if (close === -1 || close === start + 1 || isUnicodeWhitespace(value.char(close - 1) ?? "")) {
    return;
  }

  const end = close + 1;

  return {
    end,
    node: {
      kind: "math",
      range: input.sourceRange(start, end),
      value: value.slice(start + 1, close),
      format: "dollar",
    },
  };
}

/** An opening dollar that later input could still close. */
export function dollarUnclosed(value: SourceText, start: number): boolean {
  if (value.char(start + 1) === undefined) {
    return true;
  }

  if (isUnicodeWhitespace(value.char(start + 1) ?? "")) {
    return false;
  }

  let close = value.indexOf("$", start + 1);

  while (close !== -1 && escapedAt(value, close, start + 1)) {
    close = value.indexOf("$", close + 1);
  }

  return close === -1;
}
