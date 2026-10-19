import { REPLACEMENT_CHARACTER } from "./source.ts";

const PERCENT_ENCODED_BYTE = /^[0-9A-Fa-f]{2}$/u;

const LONE_SURROGATE = /^[\uD800-\uDFFF]$/u;

const URI_CHARACTERS =
  "!#$&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

export function normalizeUri(value: string): string {
  const result: string[] = [];
  const characters = Array.from(value);

  for (let index = 0; index < characters.length; index++) {
    const c = characters[index];
    const hexadecimal = `${characters[index + 1] ?? ""}${characters[index + 2] ?? ""}`;

    if (c === "%" && PERCENT_ENCODED_BYTE.test(hexadecimal)) {
      result.push(c, hexadecimal);
      index += hexadecimal.length;
      continue;
    }

    if (URI_CHARACTERS.includes(c)) {
      result.push(c);
      continue;
    }

    const scalar = LONE_SURROGATE.test(c) ? REPLACEMENT_CHARACTER : c;
    result.push(encodeURIComponent(scalar));
  }

  return result.join("");
}

export function isUrlControlCharacter(character: string): boolean {
  return character === "\0" || character <= " " || character === "\u007F";
}
