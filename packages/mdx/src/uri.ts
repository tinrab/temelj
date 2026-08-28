import { replacementCharacter } from "./utility.ts";

const percentEncodedByte = /^[0-9A-Fa-f]{2}$/u;
const loneSurrogate = /^[\uD800-\uDFFF]$/u;
const uriCharacters =
  "!#$&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

export function normalizeUri(value: string): string {
  const result: string[] = [];
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    const hexadecimal = `${characters[index + 1] ?? ""}${characters[index + 2] ?? ""}`;
    if (character === "%" && percentEncodedByte.test(hexadecimal)) {
      result.push(character, hexadecimal);
      index += hexadecimal.length;
      continue;
    }
    if (uriCharacters.includes(character)) {
      result.push(character);
      continue;
    }
    const scalar = loneSurrogate.test(character) ? replacementCharacter : character;
    result.push(encodeURIComponent(scalar));
  }
  return result.join("");
}
