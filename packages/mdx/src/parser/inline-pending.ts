import type { SourceText } from "../source-text.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { InlineInput } from "./inline-input.ts";
import type { Output } from "./inline-output.ts";
import type { InlinePendingSyntax } from "./inline-syntax.ts";

import { isUnicodeWhitespace } from "./characters.ts";
import { codeSpan } from "./inline-code.ts";
import {
  bracketText,
  delimiterText,
  isBracket,
  isDelimiter,
  markerRunEnd,
  mergeText,
  textNode,
} from "./inline-output.ts";

// The construct still open at the end of a stream's input.

export interface PendingCandidate {
  readonly start: number;
  readonly pending: InlinePendingSyntax;
}

/**
 * The construct still open at the end of the input. Before `from`, a safe
 * point, every construct is closed, so scans start there, and at `fromOutput`
 * in the output.
 */
export function pendingInline(
  input: InlineInput,
  value: SourceText,
  output: readonly Output[],
  openEmbedded: PendingCandidate | undefined,
  syntax: ResolvedSyntaxOptions,
  from: number,
  fromOutput: number,
): InlinePendingSyntax | undefined {
  const candidates: PendingCandidate[] = openEmbedded === undefined ? [] : [openEmbedded];

  for (let index = output.length - 1; index >= fromOutput; index--) {
    const opener = output[index];

    if (!isDelimiter(opener) || !opener.canOpen || index === output.length - 1) {
      continue;
    }

    const kind =
      opener.marker === "~"
        ? opener.length >= (syntax.singleTilde ? 1 : 2)
          ? "delete"
          : undefined
        : opener.length >= 2
          ? "strong"
          : "emphasis";

    if (kind === undefined || isUnicodeWhitespace(value.char(opener.start + opener.length) ?? "")) {
      continue;
    }

    const children = output
      .slice(index + 1)
      .map((entry) =>
        isDelimiter(entry)
          ? delimiterText(input, entry)
          : isBracket(entry)
            ? bracketText(input, entry)
            : entry,
      );

    candidates.push({
      start: opener.start,
      pending: {
        kind,
        range: input.sourceRange(opener.start, input.length),
        children: mergeText(children),
      },
    });
    break;
  }

  for (let offset = from; offset < value.length;) {
    if (value.char(offset) !== "`") {
      offset++;
      continue;
    }

    const matched = codeSpan(input, value, offset);

    if (matched !== undefined) {
      offset = matched.end;
      continue;
    }

    const openingEnd = markerRunEnd(value, offset, "`");

    if (openingEnd < value.length) {
      candidates.push({
        start: offset,
        pending: {
          kind: "code",
          range: input.sourceRange(offset, input.length),
          value: value.slice(openingEnd).replace(/\r\n|[\r\n]/gu, " "),
        },
      });
    }

    break;
  }

  const pendingLink = /(!?)\[([^\]]+)\]\(([^)]*)$/u.exec(value.slice(from));

  if (pendingLink !== null) {
    const start = from + pendingLink.index;
    const image = pendingLink[1] === "!";
    candidates.push({
      start,
      pending: image
        ? {
            kind: "image",
            range: input.sourceRange(start, input.length),
            alt: pendingLink[2],
          }
        : {
            kind: "link",
            range: input.sourceRange(start, input.length),
            children: [textNode(input, value, start + 1, start + 1 + pendingLink[2].length)],
          },
    });
  }

  if (syntax.math.includes("tex")) {
    const start = value.lastIndexOf("\\(");

    if (start !== -1 && value.indexOf("\\)", start + 2) === -1 && start + 2 < value.length) {
      candidates.push({
        start,
        pending: {
          kind: "math",
          range: input.sourceRange(start, input.length),
          value: value.slice(start + 2),
          format: "tex",
        },
      });
    }
  }

  if (syntax.math.includes("dollar")) {
    const start = value.lastIndexOf("$");

    if (
      start !== -1 &&
      start + 1 < value.length &&
      !isUnicodeWhitespace(value.char(start + 1) ?? "")
    ) {
      candidates.push({
        start,
        pending: {
          kind: "math",
          range: input.sourceRange(start, input.length),
          value: value.slice(start + 1),
          format: "dollar",
        },
      });
    }
  }

  return candidates.sort((left, right) => right.start - left.start)[0]?.pending;
}
