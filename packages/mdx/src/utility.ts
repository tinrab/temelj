// Unclassified common utils

export function applyOptionalUpdate<T>(
  current: T | undefined,
  update: T | null | undefined,
): T | undefined {
  return update === undefined ? current : (update ?? undefined);
}

export function lineStartOffset(source: string, offset: number): number {
  const searchFrom = Math.max(0, offset - 1);
  return Math.max(source.lastIndexOf("\n", searchFrom), source.lastIndexOf("\r", searchFrom)) + 1;
}

export function lineStartOffsets(source: string): readonly number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\r") {
      if (source[index + 1] === "\n") {
        index++;
      }
      offsets.push(index + 1);
    } else if (source[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

export function sameSequence<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** The semantic character represented by NUL in parsed source. */
export const replacementCharacter = "\uFFFD";

export const byteOrderMark = "\uFEFF";

export function semanticCharacter(value: string): string {
  return value === "\0" ? replacementCharacter : value;
}

export function isLineEnding(value: string): boolean {
  return value === "\n" || value === "\r";
}

export function isMarkdownSpace(value: string): boolean {
  return value === " " || value === "\t" || isLineEnding(value);
}

export function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
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
  source: string,
  target: string,
  start: number,
  end: number,
): number | undefined {
  for (let offset = start; offset < end; offset++) {
    if (source[offset] === target && !isEscaped(source, offset, start)) {
      return offset;
    }
  }
  return;
}

export function isEscaped(source: string, offset: number, lowerBound: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= lowerBound && source[index] === "\\"; index--) {
    slashes++;
  }
  return slashes % 2 === 1;
}

export function isAsciiLetter(value: string): boolean {
  return (value >= "A" && value <= "Z") || (value >= "a" && value <= "z");
}

export function isAsciiAlphanumeric(value: string): boolean {
  return isAsciiLetter(value) || isAsciiDigit(value);
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
  return isAsciiPunctuation(value) || /^[\p{P}\p{S}]$/u.test(value);
}

export function nextTabColumn(column: number): number {
  return column + (4 - ((column - 1) % 4));
}

export interface ConsumedIndent {
  readonly offset: number;
  readonly columns: number;
}

/** Consumes source indentation using four-column tab stops. */
export function consumeIndent(
  source: string,
  start: number,
  end: number,
  maximum: number,
): ConsumedIndent {
  let column = 1;
  let offset = start;
  while (offset < end) {
    const character = source[offset];
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

export function encodeNumericCharacterReference(code: number): string {
  return `&#x${code.toString(16).toUpperCase()};`;
}
