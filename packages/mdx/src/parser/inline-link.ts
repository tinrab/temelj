import type { SourceText } from "../source-text.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { Bracket, Delimiter, Output } from "./inline-output.ts";
import type { DefinitionLookup, InlineSyntax } from "./inline-syntax.ts";

import {
  decodeNamedCharacterReference,
  decodeNumericCharacterReference,
} from "../character-reference.ts";
import { normalizeIdentifier } from "../identifier.ts";
import { isUnicodeWhitespace } from "./characters.ts";
import { matchLiteralAutolink } from "./inline-autolink.ts";
import { resolveDelimiters } from "./inline-emphasis.ts";
import { InlineInput } from "./inline-input.ts";
import {
  bracketText,
  delimiterText,
  escapedAt,
  findUnescapedInline,
  isBracket,
  isDelimiter,
  mergeText,
  textNode,
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
  syntax: ResolvedSyntaxOptions,
  definitions: DefinitionLookup,
  references: Set<string>,
  nested: boolean,
): Readonly<{ end: number; link: boolean }> | undefined {
  const outputIndex = output.lastIndexOf(bracket);

  if (outputIndex === -1) {
    throw new Error("Bracket stack diverged from inline output");
  }

  if (!bracket.active) {
    output[outputIndex] = bracketText(input, bracket);

    return;
  }

  const labelStart = bracket.start + (bracket.image ? 2 : 1);
  const label = value.slice(labelStart, close);

  if (
    !bracket.image &&
    label.startsWith("^") &&
    !label.slice(1).includes("[") &&
    !label.slice(1).includes("]")
  ) {
    output.splice(outputIndex, output.length - outputIndex, {
      kind: "footnoteReference",
      range: input.sourceRange(bracket.start, close + 1),
      identifier: normalizeIdentifier(label.slice(1)),
    });
    removeDetachedDelimiters(delimiters, bracket);

    return { end: close + 1, link: true };
  }

  const inline = value.char(close + 1) === "(" ? linkDestination(value, close + 2) : undefined;
  const reference = inline === undefined ? referenceSuffix(value, close + 1) : undefined;
  const identifier = normalizeIdentifier(reference?.label || label);
  const defined = definitions.has(identifier);

  if (inline === undefined) {
    if (identifier !== "" && (nested || /(?:https?:\/\/|www\.|@)/iu.test(label))) {
      references.add(identifier);
    }

    // Missing inner references remain label text. A later definition reparses their dependents.
    if (identifier === "" || (nested && !defined)) {
      output[outputIndex] = bracketText(input, bracket);

      return;
    }
  }

  resolveDelimiters(input, output, delimiters, syntax, bracket.start);

  const children = output
    .slice(outputIndex + 1)
    .map((entry) =>
      isDelimiter(entry)
        ? delimiterText(input, entry)
        : isBracket(entry)
          ? bracketText(input, entry)
          : entry,
    );

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

    return { end: inline.end, link: !bracket.image };
  }

  const end = reference?.end ?? close + 1;
  const autolinks = !defined && !bracket.image ? fallbackAutolinks(input, children) : undefined;

  if (autolinks !== undefined) {
    output.splice(
      outputIndex,
      output.length - outputIndex,
      bracketText(input, bracket),
      ...autolinks,
      textNode(input, value, close, end),
    );
  } else {
    output.splice(outputIndex, output.length - outputIndex, {
      kind: "reference",
      range: input.sourceRange(bracket.start, end),
      identifier,
      referenceKind:
        reference === undefined ? "shortcut" : reference.label === "" ? "collapsed" : "full",
      image: bracket.image,
      children: mergeText(children),
    });
  }

  removeDetachedDelimiters(delimiters, bracket);

  return { end, link: defined && !bracket.image };
}

/** Literal labels resume normal autolinking when no reference definition exists. */
function fallbackAutolinks(
  input: InlineInput,
  children: readonly InlineSyntax[],
): InlineSyntax[] | undefined {
  const output: InlineSyntax[] = [];
  let changed = false;

  for (const child of children) {
    if (child.kind !== "text" || !/(?:https?:\/\/|www\.|@)/iu.test(child.value)) {
      output.push(child);
      continue;
    }

    const part = new InlineInput(input.file, [{ kind: "source", range: child.range }]);
    const value = part.text();

    if (value.toString() !== child.value) {
      output.push(child);
      continue;
    }

    let start = 0;

    for (let offset = 0; offset < value.length; offset++) {
      const match = matchLiteralAutolink(part, value, offset);

      if (match === undefined) {
        continue;
      }

      if (start < offset) {
        output.push(textNode(part, value, start, offset));
      }

      output.push(match.node);
      offset = match.end - 1;
      start = match.end;
      changed = true;
    }

    if (start < value.length) {
      output.push(textNode(part, value, start, value.length));
    }
  }

  return changed ? output : undefined;
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
