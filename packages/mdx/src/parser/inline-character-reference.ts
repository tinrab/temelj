import type { SourceText } from "../source-text.ts";
import type { InlineInput } from "./inline-input.ts";
import type { InlineMatch } from "./inline-output.ts";

import {
  decodeNamedCharacterReference,
  decodeNumericCharacterReference,
} from "../character-reference.ts";

// Character references.

export function characterReference(
  input: InlineInput,
  value: SourceText,
  start: number,
): InlineMatch | undefined {
  const match = /^&(#(?:\d{1,7}|[xX][\dA-Fa-f]{1,6})|[A-Za-z][\dA-Za-z]{1,30});/u.exec(
    value.slice(start),
  );

  if (match === null) {
    return;
  }

  const body = match[1];

  const decoded = body.startsWith("#")
    ? decodeNumericCharacterReference(
        body.slice(body[1] === "x" || body[1] === "X" ? 2 : 1),
        body[1] === "x" || body[1] === "X" ? 16 : 10,
      )
    : decodeNamedCharacterReference(body);

  if (decoded === undefined) {
    return;
  }

  const end = start + match[0].length;

  return {
    end,
    node: { kind: "text", range: input.sourceRange(start, end), value: decoded },
  };
}
