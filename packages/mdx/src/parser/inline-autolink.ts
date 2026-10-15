import type { SourceText } from "../source-text.ts";
import type { InlineInput } from "./inline-input.ts";
import type { InlineMatch } from "./inline-output.ts";

import { textNode } from "./inline-output.ts";

// Literal autolinks: URLs, `www.` links, and email addresses.

export function matchLiteralAutolink(
  input: InlineInput,
  value: SourceText,
  start: number,
): InlineMatch | undefined {
  const before = value.char(start - 1);

  if (before !== undefined && /[\p{L}\p{N}_]/u.test(before)) {
    return;
  }

  const rest = value.slice(start);
  const url = /^(?:https?:\/\/|www\.)[^\s<>]+/iu.exec(rest)?.[0];
  const email = /^[\w.+-]+@[A-Za-z\d-]+(?:\.[A-Za-z\d-]+)+/u.exec(rest)?.[0];
  let label = url ?? email;

  if (label === undefined) {
    return;
  }

  if (url !== undefined) {
    label = trimAutolinkPunctuation(label);
  }

  if (label === "") {
    return;
  }

  const end = start + label.length;

  const destination =
    email !== undefined ? `mailto:${label}` : label.startsWith("www.") ? `http://${label}` : label;

  return {
    end,
    node: {
      kind: "link",
      range: input.sourceRange(start, end),
      destination,
      title: undefined,
      children: [textNode(input, value, start, end)],
    },
  };
}

function trimAutolinkPunctuation(value: string): string {
  let end = value.length;

  while (end > 0 && /[!"'*,.:;?]/u.test(value[end - 1])) {
    end--;
  }

  while (
    end > 0 &&
    value[end - 1] === ")" &&
    countCharacter(value.slice(0, end), ")") > countCharacter(value.slice(0, end), "(")
  ) {
    end--;
  }

  return value.slice(0, end);
}

function countCharacter(value: string, character: string): number {
  let count = 0;

  for (const candidate of value) {
    if (candidate === character) {
      count++;
    }
  }

  return count;
}
