import { NAMED_CHARACTER_REFERENCES } from "./character-entities.ts";

export function decodeNamedCharacterReference(value: string): string | undefined {
  return Object.hasOwn(NAMED_CHARACTER_REFERENCES, value)
    ? NAMED_CHARACTER_REFERENCES[value]
    : undefined;
}

export function decodeNumericCharacterReference(value: string, base: 10 | 16): string {
  const code = Number.parseInt(value, base);
  const low = code % 65_536;

  if (
    code < 9 ||
    code === 11 ||
    (code > 13 && code < 32) ||
    (code > 126 && code < 160) ||
    (code > 55_295 && code < 57_344) ||
    (code > 64_975 && code < 65_008) ||
    low === 65_535 ||
    low === 65_534 ||
    code > 1_114_111
  ) {
    return "\uFFFD";
  }

  return String.fromCodePoint(code);
}

export function encodeNumericCharacterReference(code: number): string {
  return `&#x${code.toString(16).toUpperCase()};`;
}
