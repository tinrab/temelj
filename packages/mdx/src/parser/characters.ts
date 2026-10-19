import type { SourceText } from "../source-text.ts";

import { nextTabColumn } from "../source.ts";

// Maybe refactor?

export function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

export function isAsciiLetter(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z]$/u.test(value);
}

export function isSpaceOrTab(value: string | undefined): boolean {
  return value === " " || value === "\t";
}

export function isBlank(value: string): boolean {
  for (const character of value) {
    if (!isSpaceOrTab(character)) {
      return false;
    }
  }

  return true;
}

export function findUnescaped(
  source: SourceText,
  target: string,
  start: number,
  end: number,
): number | undefined {
  for (let offset = start; offset < end; offset++) {
    if (source.char(offset) === target && !isEscaped(source, offset, start)) {
      return offset;
    }
  }

  return;
}

export function isEscaped(source: SourceText, offset: number, lowerBound: number): boolean {
  let slashes = 0;

  for (let index = offset - 1; index >= lowerBound && source.char(index) === "\\"; index--) {
    slashes++;
  }

  return slashes % 2 === 1;
}

export function isAsciiPunctuation(value: string): boolean {
  return (
    (value >= "!" && value <= "/") ||
    (value >= ":" && value <= "@") ||
    (value >= "[" && value <= "`") ||
    (value >= "{" && value <= "~")
  );
}

export function isUnicodeWhitespace(value: string): boolean {
  return /^\s$/u.test(value);
}

export function isUnicodePunctuation(value: string): boolean {
  return value < "\x80" ? isAsciiPunctuation(value) : /^[\p{P}\p{S}]$/u.test(value);
}

export interface ConsumedIndent {
  readonly offset: number;
  readonly columns: number;
}

/** Consumes source indentation using four-column tab stops. */
export function consumeIndent(
  source: SourceText,
  start: number,
  end: number,
  maximum: number,
): ConsumedIndent {
  let column = 1;
  let offset = start;

  while (offset < end) {
    const character = source.char(offset);

    const next =
      character === " " ? column + 1 : character === "\t" ? nextTabColumn(column) : column;

    if (next === column || next - 1 > maximum) {
      break;
    }

    column = next;
    offset++;
  }

  return Object.freeze({ offset, columns: column - 1 });
}
