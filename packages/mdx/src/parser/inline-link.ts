import type { SourceText } from "../source-text.ts";
import type { InlineInput } from "./inline-input.ts";
import type { Bracket, Delimiter, Output } from "./inline-output.ts";
import type { InlineSyntax } from "./inline-syntax.ts";

import {
  decodeNamedCharacterReference,
  decodeNumericCharacterReference,
} from "../character-reference.ts";
import { normalizeIdentifier } from "../identifier.ts";
import { isUnicodeWhitespace } from "./characters.ts";
import {
  bracketText,
  delimiterText,
  escapedAt,
  findUnescapedInline,
  isBracket,
  isDelimiter,
  mergeText,
} from "./inline-output.ts";

// Links, images, references, and footnote references, resolved at a closing bracket.

interface ReferenceSuffix {
  readonly end: number;
  readonly label: string;
}

export function resolveBracket(
  input: InlineInput,
  value: SourceText,
  close: number,
  bracket: Bracket,
  output: Output[],
  delimiters: Delimiter[],
): number | undefined {
  // The innermost open bracket is the most recent bracket, so it is found from the end.
  const outputIndex = output.lastIndexOf(bracket);

  if (outputIndex === -1) {
    throw new Error("Bracket stack diverged from inline output");
  }

  if (!bracket.active) {
    output[outputIndex] = bracketText(input, bracket);

    return;
  }

  const children = output
    .slice(outputIndex + 1)
    .map((entry) =>
      isDelimiter(entry)
        ? delimiterText(input, entry)
        : isBracket(entry)
          ? bracketText(input, entry)
          : entry,
    );

  const labelStart = bracket.start + (bracket.image ? 2 : 1);
  const label = value.slice(labelStart, close);

  if (
    !bracket.image &&
    label.startsWith("^") &&
    !label.slice(1).includes("[") &&
    !label.slice(1).includes("]")
  ) {
    const identifier = normalizeIdentifier(label.slice(1));
    output.splice(outputIndex, output.length - outputIndex, {
      kind: "footnoteReference",
      range: input.sourceRange(bracket.start, close + 1),
      identifier,
    });
    removeDetachedDelimiters(delimiters, bracket);

    return close + 1;
  }

  const inline = value.char(close + 1) === "(" ? linkDestination(value, close + 2) : undefined;

  if (inline !== undefined) {
    const destination = decodeLinkString(inline.destination);

    const node: InlineSyntax = bracket.image
      ? {
          kind: "image",
          range: input.sourceRange(bracket.start, inline.end),
          destination,
          title: inline.title === undefined ? undefined : decodeLinkString(inline.title),
          alt: inlinePlainText(children),
        }
      : {
          kind: "link",
          range: input.sourceRange(bracket.start, inline.end),
          destination,
          title: inline.title === undefined ? undefined : decodeLinkString(inline.title),
          children: mergeText(children),
        };

    output.splice(outputIndex, output.length - outputIndex, node);
    removeDetachedDelimiters(delimiters, bracket);

    return inline.end;
  }

  const reference = referenceSuffix(value, close + 1);

  const referenceKind =
    reference === undefined ? "shortcut" : reference.label === "" ? "collapsed" : "full";

  const identifier = normalizeIdentifier(reference?.label || label);

  if (identifier === "") {
    output[outputIndex] = bracketText(input, bracket);

    return;
  }

  const end = reference?.end ?? close + 1;
  output.splice(outputIndex, output.length - outputIndex, {
    kind: "reference",
    range: input.sourceRange(bracket.start, end),
    identifier,
    referenceKind,
    image: bracket.image,
    children: mergeText(children),
  });
  removeDetachedDelimiters(delimiters, bracket);

  return end;
}

interface LinkDestinationResult {
  readonly destination: string;
  readonly end: number;
  readonly title: string | undefined;
}

function linkDestination(value: SourceText, start: number): LinkDestinationResult | undefined {
  let cursor = start;

  while (value.char(cursor) === " " || value.char(cursor) === "\t" || value.char(cursor) === "\n") {
    cursor++;
  }

  let destination = "";

  if (value.char(cursor) === "<") {
    const end = findUnescapedInline(value, ">", cursor + 1);

    if (end === undefined || /[\r\n<]/u.test(value.slice(cursor + 1, end))) {
      return;
    }

    destination = value.slice(cursor + 1, end);
    cursor = end + 1;
  } else {
    const destinationStart = cursor;
    let depth = 0;

    while (cursor < value.length) {
      const character = value.char(cursor);

      if (isUnicodeWhitespace(character ?? "")) {
        break;
      }

      if (character === "(" && !escapedAt(value, cursor, destinationStart)) {
        if (++depth > 32) {
          return;
        }
      } else if (character === ")" && !escapedAt(value, cursor, destinationStart)) {
        if (depth === 0) {
          break;
        }

        depth--;
      }

      cursor++;
    }

    if (depth !== 0) {
      return;
    }

    destination = value.slice(destinationStart, cursor);
  }

  const beforeWhitespace = cursor;

  while (isUnicodeWhitespace(value.char(cursor) ?? "")) {
    cursor++;
  }

  let title: string | undefined;

  if (cursor !== beforeWhitespace && value.char(cursor) !== ")") {
    const opener = value.char(cursor);
    const closer = opener === "(" ? ")" : opener === "'" ? "'" : opener === '"' ? '"' : undefined;

    if (closer === undefined) {
      return;
    }

    const titleEnd = findUnescapedInline(value, closer, cursor + 1);

    if (titleEnd === undefined) {
      return;
    }

    title = value.slice(cursor + 1, titleEnd);
    cursor = titleEnd + 1;

    while (isUnicodeWhitespace(value.char(cursor) ?? "")) {
      cursor++;
    }
  }

  return value.char(cursor) === ")" ? { destination, end: cursor + 1, title } : undefined;
}

function referenceSuffix(value: SourceText, start: number): ReferenceSuffix | undefined {
  if (value.char(start) !== "[") {
    return;
  }

  const end = findUnescapedInline(value, "]", start + 1);

  if (end === undefined || end - start > 1000 || value.slice(start + 1, end).includes("[")) {
    return;
  }

  return { end: end + 1, label: value.slice(start + 1, end) };
}

function decodeLinkString(value: string): string {
  return value.replace(
    /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|[xX][\dA-Fa-f]{1,6})|[A-Za-z][\dA-Za-z]{1,30});/gu,
    (match, escaped: string | undefined, reference: string | undefined) => {
      if (escaped !== undefined) {
        return escaped;
      }

      if (reference === undefined) {
        return match;
      }

      if (!reference.startsWith("#")) {
        return decodeNamedCharacterReference(reference) ?? match;
      }

      const hexadecimal = reference[1] === "x" || reference[1] === "X";

      return decodeNumericCharacterReference(
        reference.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
    },
  );
}

function inlinePlainText(nodes: readonly InlineSyntax[]): string {
  return nodes
    .map((node) =>
      node.kind === "text" || node.kind === "code" || node.kind === "rawHtml"
        ? node.value
        : "children" in node
          ? inlinePlainText(node.children)
          : "",
    )
    .join("");
}

/** Delimiters after a resolved bracket are inside its node. */
function removeDetachedDelimiters(delimiters: Delimiter[], bracket: Bracket): void {
  while ((delimiters.at(-1)?.start ?? -1) > bracket.start) {
    delimiters.pop();
  }
}
