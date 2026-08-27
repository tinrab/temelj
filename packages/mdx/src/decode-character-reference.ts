import { namedCharacterReferences } from "./character-entities.ts";

export function decodeNamedCharacterReference(value: string): string | undefined {
  return Object.hasOwn(namedCharacterReferences, value)
    ? namedCharacterReferences[value]
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

const characterEscapeOrReference =
  /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/giu;

/** Decode escapes and character references in source string content. */
export function decodeSourceString(value: string): string {
  return value.replace(
    characterEscapeOrReference,
    (match, escaped: string | undefined, reference: string | undefined) => {
      if (escaped !== undefined) {
        return escaped;
      }
      if (reference === undefined) {
        return match;
      }
      if (reference.charCodeAt(0) !== 35) {
        return decodeNamedCharacterReference(reference) ?? match;
      }
      const hexadecimal = reference.charCodeAt(1) === 120 || reference.charCodeAt(1) === 88;
      return decodeNumericCharacterReference(
        reference.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
    },
  );
}
