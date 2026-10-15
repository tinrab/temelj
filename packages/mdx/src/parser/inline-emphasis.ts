import type { SourceText } from "../source-text.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { InlineInput } from "./inline-input.ts";
import type { Delimiter, Output } from "./inline-output.ts";
import type { InlineSyntax } from "./inline-syntax.ts";

import { isUnicodePunctuation, isUnicodeWhitespace } from "./characters.ts";
import { bracketText, delimiterText, isBracket, isDelimiter, mergeText } from "./inline-output.ts";

// Emphasis, strong, and strikethrough from delimiter runs, resolved as closers arrive.

export function createDelimiter(
  value: SourceText,
  start: number,
  end: number,
  marker: Delimiter["marker"],
): Delimiter {
  const before = value.char(start - 1);
  const after = value.char(end);
  const beforeWhitespace = before === undefined || isUnicodeWhitespace(before);
  const afterWhitespace = after === undefined || isUnicodeWhitespace(after);
  const beforePunctuation = before !== undefined && isUnicodePunctuation(before);
  const afterPunctuation = after !== undefined && isUnicodePunctuation(after);

  const leftFlanking =
    !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);

  const rightFlanking =
    !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);

  return {
    marker,
    length: end - start,
    originalLength: end - start,
    start,
    canOpen: marker === "_" ? leftFlanking && (!rightFlanking || beforePunctuation) : leftFlanking,
    canClose: marker === "_" ? rightFlanking && (!leftFlanking || afterPunctuation) : rightFlanking,
  };
}

export function resolveCloser(
  input: InlineInput,
  output: Output[],
  delimiters: Delimiter[],
  closer: Delimiter,
  syntax: ResolvedSyntaxOptions,
): void {
  if (!closer.canClose) {
    return;
  }

  while (closer.length > 0) {
    const closerIndex = delimiters.lastIndexOf(closer);
    let openerIndex = -1;

    for (let index = closerIndex - 1; index >= 0; index--) {
      const candidate = delimiters[index];

      if (
        candidate.marker === closer.marker &&
        candidate.canOpen &&
        !violatesRuleOfThree(candidate, closer)
      ) {
        openerIndex = index;
        break;
      }
    }

    const opener = delimiters[openerIndex];

    if (opener === undefined) {
      return;
    }

    const use =
      closer.marker === "~"
        ? opener.length >= 2 && closer.length >= 2
          ? 2
          : syntax.singleTilde
            ? 1
            : 2
        : opener.length >= 2 && closer.length >= 2
          ? 2
          : 1;

    if (opener.length < use || closer.length < use) {
      return;
    }

    // The closer was just pushed and the opener precedes it, so both are found from the end.
    const closerOutput = output.lastIndexOf(closer);
    const openerOutput = closerOutput === -1 ? -1 : output.lastIndexOf(opener, closerOutput - 1);

    if (openerOutput === -1 || closerOutput === -1 || openerOutput >= closerOutput) {
      throw new Error("Delimiter stack diverged from inline output");
    }

    const children = output
      .slice(openerOutput + 1, closerOutput)
      .map((entry) =>
        isDelimiter(entry)
          ? delimiterText(input, entry)
          : isBracket(entry)
            ? bracketText(input, entry)
            : entry,
      );

    opener.length -= use;
    const nodeStart = opener.start + opener.length;
    const nodeEnd = closer.start + use;
    closer.start += use;
    closer.length -= use;

    const node: InlineSyntax = {
      kind: closer.marker === "~" ? "delete" : use === 2 ? "strong" : "emphasis",
      range: input.sourceRange(nodeStart, nodeEnd),
      children: mergeText(children),
    };

    output.splice(openerOutput + 1, closerOutput - openerOutput - 1, node);
    // Delimiters between the pair are now inside the node.
    delimiters.splice(openerIndex + 1, closerIndex - openerIndex - 1);
    let closerAt = openerOutput + 2;

    if (opener.length === 0) {
      output.splice(openerOutput, 1);
      delimiters.splice(openerIndex, 1);
      closerAt--;
    }

    if (closer.length === 0) {
      output.splice(closerAt, 1);
      delimiters.splice(delimiters.lastIndexOf(closer), 1);

      return;
    }
  }
}

function violatesRuleOfThree(opener: Delimiter, closer: Delimiter): boolean {
  return (
    (opener.canClose || closer.canOpen) &&
    (opener.originalLength + closer.originalLength) % 3 === 0 &&
    (opener.originalLength % 3 !== 0 || closer.originalLength % 3 !== 0)
  );
}
