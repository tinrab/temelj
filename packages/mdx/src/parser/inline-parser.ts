import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { InlineInput } from "./inline-input.ts";
import type {
  InlineDirectiveAttribute,
  InlineParseResult,
  InlinePendingSyntax,
  InlineSyntax,
} from "./inline-syntax.ts";

import {
  decodeNamedCharacterReference,
  decodeNumericCharacterReference,
} from "../decode-character-reference.ts";
import { normalizeIdentifier } from "../identifier.ts";
import { sourceRange } from "../ranges.ts";
import { isAsciiPunctuation, isUnicodePunctuation, isUnicodeWhitespace } from "../utility.ts";
import { ExpressionBoundaryScanner, JsxBoundaryScanner } from "./embedded-scanner.ts";
import { parseJavaScriptBoundary } from "./javascript-boundary.ts";

interface Delimiter {
  readonly canClose: boolean;
  readonly canOpen: boolean;
  readonly marker: "*" | "_" | "~";
  readonly originalLength: number;
  length: number;
  start: number;
}

interface Bracket {
  active: boolean;
  readonly image: boolean;
  readonly start: number;
}

type Output = InlineSyntax | Delimiter | Bracket;

interface InlineMatch {
  readonly end: number;
  readonly node: InlineSyntax;
}

interface OptionalInlineMatch {
  readonly end: number;
  readonly node: InlineSyntax | undefined;
}

interface AngleMatch extends InlineMatch {
  readonly invalid: boolean;
}

interface ReferenceSuffix {
  readonly end: number;
  readonly label: string;
}

interface PendingCandidate {
  readonly start: number;
  readonly pending: InlinePendingSyntax;
}

/** Direct inline parser with one output sequence and one delimiter stack. */
export function parseInline(input: InlineInput, syntax: ResolvedSyntaxOptions): InlineParseResult {
  const value = input.toString();
  const output: Output[] = [];
  const delimiters: Delimiter[] = [];
  const brackets: Bracket[] = [];
  const invalid: { range: ReturnType<InlineInput["sourceRange"]>; syntax: "expression" | "jsx" }[] =
    [];
  const references = new Set<string>();
  const footnotes = new Set<string>();
  let textStart = 0;
  let offset = 0;

  const flushText = (end: number): void => {
    if (end > textStart) {
      output.push(textNode(input, value, textStart, end));
    }
    textStart = end;
  };

  while (offset < value.length) {
    const character = value[offset];
    if (character === ":" && syntax.directives) {
      const directive = inlineDirective(input, value, offset);
      if (directive !== undefined) {
        flushText(offset);
        output.push(directive.node);
        offset = directive.end;
        textStart = offset;
        continue;
      }
    }
    if (character === "\\" && value[offset + 1] === "(" && syntax.math.includes("tex")) {
      const math = texMath(input, value, offset);
      if (math !== undefined) {
        flushText(offset);
        output.push(math.node);
        offset = math.end;
        textStart = offset;
        continue;
      }
    }
    if (character === "$" && syntax.math.includes("dollar")) {
      const math = dollarMath(input, value, offset);
      if (math !== undefined) {
        flushText(offset);
        output.push(math.node);
        offset = math.end;
        textStart = offset;
        continue;
      }
    }
    if (character === "\n" || character === "\r") {
      let spaces = offset;
      while (spaces > textStart && value[spaces - 1] === " ") {
        spaces--;
      }
      if (offset - spaces >= 2) {
        flushText(spaces);
        const end = character === "\r" && value[offset + 1] === "\n" ? offset + 2 : offset + 1;
        output.push({ kind: "hardBreak", range: input.sourceRange(spaces, end) });
        offset = end;
        textStart = offset;
        continue;
      }
    }
    const literalAutolink = matchLiteralAutolink(input, value, offset);
    if (literalAutolink !== undefined) {
      flushText(offset);
      output.push(literalAutolink.node);
      offset = literalAutolink.end;
      textStart = offset;
      continue;
    }
    if (character === "[" || (character === "!" && value[offset + 1] === "[")) {
      const image = character === "!";
      flushText(offset);
      const bracket: Bracket = { active: true, image, start: offset };
      output.push(bracket);
      brackets.push(bracket);
      offset += image ? 2 : 1;
      textStart = offset;
      continue;
    }
    if (character === "]") {
      const bracket = brackets.at(-1);
      if (bracket !== undefined) {
        flushText(offset);
        brackets.pop();
        const resolved = resolveBracket(
          input,
          value,
          offset,
          bracket,
          output,
          delimiters,
          references,
          footnotes,
        );
        if (resolved !== undefined) {
          offset = resolved;
          textStart = offset;
          if (!bracket.image) {
            for (const opener of brackets) {
              if (!opener.image) {
                opener.active = false;
              }
            }
          }
          continue;
        }
        output.push(textNode(input, value, offset, offset + 1));
        offset++;
        textStart = offset;
        continue;
      }
    }
    if (character === "\\") {
      const next = value[offset + 1];
      if (next === "\n" || next === "\r") {
        flushText(offset);
        const end = next === "\r" && value[offset + 2] === "\n" ? offset + 3 : offset + 2;
        output.push({ kind: "hardBreak", range: input.sourceRange(offset, end) });
        offset = end;
        textStart = offset;
        continue;
      }
      if (next !== undefined && isAsciiPunctuation(next)) {
        flushText(offset);
        output.push(textNode(input, value, offset + 1, offset + 2));
        offset += 2;
        textStart = offset;
        continue;
      }
    }
    if (character === "`") {
      const code = codeSpan(input, value, offset);
      if (code !== undefined) {
        flushText(offset);
        output.push(code.node);
        offset = code.end;
        textStart = offset;
        continue;
      }
    }
    if (character === "&") {
      const reference = characterReference(input, value, offset);
      if (reference !== undefined) {
        flushText(offset);
        output.push(reference.node);
        offset = reference.end;
        textStart = offset;
        continue;
      }
    }
    if (character === "{") {
      const expression = expressionNode(input, value, offset);
      if (expression !== undefined) {
        flushText(offset);
        if (expression.node === undefined) {
          invalid.push({ range: input.sourceRange(offset, expression.end), syntax: "expression" });
          output.push(textNode(input, value, offset, expression.end));
        } else {
          output.push(expression.node);
        }
        offset = expression.end;
        textStart = offset;
        continue;
      }
    }
    if (character === "<") {
      const angle = angleNode(input, value, offset);
      if (angle !== undefined) {
        flushText(offset);
        if (angle.invalid) {
          invalid.push({ range: input.sourceRange(offset, angle.end), syntax: "jsx" });
        }
        output.push(angle.node);
        offset = angle.end;
        textStart = offset;
        continue;
      }
    }
    if (character === "*" || character === "_" || character === "~") {
      const runEnd = markerRunEnd(value, offset, character);
      const length = runEnd - offset;
      if (character !== "~" || length >= (syntax.singleTilde ? 1 : 2)) {
        flushText(offset);
        const delimiter = createDelimiter(value, offset, runEnd, character);
        output.push(delimiter);
        delimiters.push(delimiter);
        resolveCloser(input, output, delimiters, delimiter, syntax);
        offset = runEnd;
        textStart = offset;
        continue;
      }
    }
    offset++;
  }
  flushText(value.length);

  const pending = pendingInline(input, value, output, syntax);
  const nodes = mergeText(
    output.map((entry) =>
      isDelimiter(entry)
        ? delimiterText(input, entry)
        : isBracket(entry)
          ? bracketText(input, entry)
          : entry,
    ),
  );
  return {
    nodes: nodes,
    invalid: invalid.map((entry) => entry),
    references,
    footnotes,
    pending,
  };
}

function pendingInline(
  input: InlineInput,
  value: string,
  output: readonly Output[],
  syntax: ResolvedSyntaxOptions,
): InlinePendingSyntax | undefined {
  const candidates: PendingCandidate[] = [];
  for (let index = output.length - 1; index >= 0; index--) {
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
    if (kind === undefined || isUnicodeWhitespace(value[opener.start + opener.length] ?? "")) {
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

  for (let offset = 0; offset < value.length;) {
    if (value[offset] !== "`") {
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

  const pendingLink = /(!?)\[([^\]]+)\]\(([^)]*)$/u.exec(value);
  if (pendingLink !== null) {
    const start = pendingLink.index;
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
    if (start !== -1 && start + 1 < value.length && !isUnicodeWhitespace(value[start + 1])) {
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

function inlineDirective(
  input: InlineInput,
  value: string,
  start: number,
): InlineMatch | undefined {
  if (value[start + 1] === ":") {
    return;
  }
  const name = /^[A-Za-z][\w-]*/u.exec(value.slice(start + 1))?.[0];
  if (name === undefined) {
    return;
  }
  let cursor = start + 1 + name.length;
  let label: readonly InlineSyntax[] = [];
  if (value[cursor] === "[") {
    const close = findUnescapedInline(value, "]", cursor + 1);
    if (close === undefined) {
      return;
    }
    label = [textNode(input, value, cursor + 1, close)];
    cursor = close + 1;
  }
  let attributes: readonly InlineDirectiveAttribute[] = [];
  if (value[cursor] === "{") {
    const close = findUnescapedInline(value, "}", cursor + 1);
    if (close === undefined) {
      return;
    }
    attributes = parseInlineDirectiveAttributes(value.slice(cursor + 1, close));
    cursor = close + 1;
  }
  if (label.length === 0 && attributes.length === 0) {
    return;
  }
  return {
    end: cursor,
    node: {
      kind: "directive",
      range: input.sourceRange(start, cursor),
      name,
      label,
      attributes,
    },
  };
}

function parseInlineDirectiveAttributes(source: string): readonly InlineDirectiveAttribute[] {
  const attributes: InlineDirectiveAttribute[] = [];
  const pattern = /([A-Za-z_:][\w:.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?|([.#])([\w-]+)/gu;
  for (const match of source.matchAll(pattern)) {
    const shortcut = match[5];
    attributes.push({
      name: shortcut === "#" ? "id" : shortcut === "." ? "class" : match[1],
      value: shortcut === undefined ? (match[2] ?? match[3] ?? match[4] ?? "") : match[6],
    });
  }
  return attributes;
}

function texMath(input: InlineInput, value: string, start: number): InlineMatch | undefined {
  let close = value.indexOf("\\)", start + 2);
  while (close !== -1 && escapedAt(value, close, start + 2)) {
    close = value.indexOf("\\)", close + 2);
  }
  if (close === -1) {
    return;
  }
  const end = close + 2;
  return {
    end,
    node: {
      kind: "math",
      range: input.sourceRange(start, end),
      value: value.slice(start + 2, close),
      format: "tex",
    },
  };
}

function dollarMath(input: InlineInput, value: string, start: number): InlineMatch | undefined {
  if (value[start + 1] === undefined || isUnicodeWhitespace(value[start + 1])) {
    return;
  }
  let close = value.indexOf("$", start + 1);
  while (close !== -1 && escapedAt(value, close, start + 1)) {
    close = value.indexOf("$", close + 1);
  }
  if (close === -1 || close === start + 1 || isUnicodeWhitespace(value[close - 1])) {
    return;
  }
  const end = close + 1;
  return {
    end,
    node: {
      kind: "math",
      range: input.sourceRange(start, end),
      value: value.slice(start + 1, close),
      format: "dollar",
    },
  };
}

function matchLiteralAutolink(
  input: InlineInput,
  value: string,
  start: number,
): InlineMatch | undefined {
  const before = value[start - 1];
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

function resolveBracket(
  input: InlineInput,
  value: string,
  close: number,
  bracket: Bracket,
  output: Output[],
  delimiters: Delimiter[],
  references: Set<string>,
  footnotes: Set<string>,
): number | undefined {
  const outputIndex = output.indexOf(bracket);
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
    footnotes.add(identifier);
    output.splice(outputIndex, output.length - outputIndex, {
      kind: "footnoteReference",
      range: input.sourceRange(bracket.start, close + 1),
      identifier,
    });
    removeDetachedDelimiters(output, delimiters);
    return close + 1;
  }

  const inline = value[close + 1] === "(" ? linkDestination(value, close + 2) : undefined;
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
    removeDetachedDelimiters(output, delimiters);
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
  references.add(identifier);
  const end = reference?.end ?? close + 1;
  output.splice(outputIndex, output.length - outputIndex, {
    kind: "reference",
    range: input.sourceRange(bracket.start, end),
    identifier,
    referenceKind,
    image: bracket.image,
    children: mergeText(children),
  });
  removeDetachedDelimiters(output, delimiters);
  return end;
}

interface LinkDestinationResult {
  readonly destination: string;
  readonly end: number;
  readonly title: string | undefined;
}

function linkDestination(value: string, start: number): LinkDestinationResult | undefined {
  let cursor = start;
  while (value[cursor] === " " || value[cursor] === "\t" || value[cursor] === "\n") {
    cursor++;
  }
  let destination = "";
  if (value[cursor] === "<") {
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
      const character = value[cursor];
      if (isUnicodeWhitespace(character)) {
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
  while (isUnicodeWhitespace(value[cursor] ?? "")) {
    cursor++;
  }
  let title: string | undefined;
  if (cursor !== beforeWhitespace && value[cursor] !== ")") {
    const opener = value[cursor];
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
    while (isUnicodeWhitespace(value[cursor] ?? "")) {
      cursor++;
    }
  }
  return value[cursor] === ")" ? { destination, end: cursor + 1, title } : undefined;
}

function referenceSuffix(value: string, start: number): ReferenceSuffix | undefined {
  if (value[start] !== "[") {
    return;
  }
  const end = findUnescapedInline(value, "]", start + 1);
  if (end === undefined || end - start > 1000 || value.slice(start + 1, end).includes("[")) {
    return;
  }
  return { end: end + 1, label: value.slice(start + 1, end) };
}

function findUnescapedInline(value: string, target: string, start: number): number | undefined {
  for (let offset = start; offset < value.length; offset++) {
    if (value[offset] === target && !escapedAt(value, offset, start)) {
      return offset;
    }
  }
  return;
}

function escapedAt(value: string, offset: number, lowerBound: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= lowerBound && value[index] === "\\"; index--) {
    slashes++;
  }
  return slashes % 2 === 1;
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

function removeDetachedDelimiters(output: readonly Output[], delimiters: Delimiter[]): void {
  for (let index = delimiters.length - 1; index >= 0; index--) {
    if (!output.includes(delimiters[index])) {
      delimiters.splice(index, 1);
    }
  }
}

function textNode(input: InlineInput, value: string, start: number, end: number): InlineSyntax {
  return {
    kind: "text",
    range: input.sourceRange(start, end),
    value: value.slice(start, end),
  };
}

function codeSpan(input: InlineInput, value: string, start: number): InlineMatch | undefined {
  const openerEnd = markerRunEnd(value, start, "`");
  const size = openerEnd - start;
  let search = openerEnd;
  while (search < value.length) {
    const candidate = value.indexOf("`", search);
    if (candidate === -1) {
      return;
    }
    const end = markerRunEnd(value, candidate, "`");
    if (end - candidate === size) {
      let code = value.slice(openerEnd, candidate).replace(/\r\n|[\r\n]/gu, " ");
      if (/^ .* $/u.test(code) && /[^ ]/u.test(code)) {
        code = code.slice(1, -1);
      }
      return {
        end,
        node: { kind: "code", range: input.sourceRange(start, end), value: code },
      };
    }
    search = end;
  }
  return;
}

function characterReference(
  input: InlineInput,
  value: string,
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

function expressionNode(
  input: InlineInput,
  value: string,
  start: number,
): OptionalInlineMatch | undefined {
  const scanner = new ExpressionBoundaryScanner();
  const structural = scanner.append(value.slice(start + 1));
  if (structural.kind === "open") {
    return { end: value.length, node: undefined };
  }
  const end = start + 1 + structural.offset;
  if (structural.kind === "invalid") {
    return { end, node: undefined };
  }
  const authored = value.slice(start + 1, end - 1);
  const boundary =
    authored.trim() === ""
      ? undefined
      : parseJavaScriptBoundary(
          "expression",
          authored,
          input.sourceRange(start + 1, start + 1).start,
        );
  return {
    end,
    node:
      authored.trim() === "" || boundary?.kind === "valid"
        ? {
            kind: "expression",
            range: input.sourceRange(start, end),
            value: authored,
          }
        : undefined,
  };
}

function angleNode(input: InlineInput, value: string, start: number): AngleMatch | undefined {
  const rest = value.slice(start);
  if (/^<(?:!--|!\[CDATA\[|\?|!)/u.test(rest)) {
    const closing = rest.startsWith("<!--")
      ? "-->"
      : rest.startsWith("<![CDATA[")
        ? "]] >".replace(" ", "")
        : rest.startsWith("<?")
          ? "?>"
          : ">";
    const close = rest.indexOf(closing, 2);
    if (close === -1) {
      return;
    }
    const end = start + close + closing.length;
    return {
      end,
      invalid: false,
      node: {
        kind: "rawHtml",
        range: input.sourceRange(start, end),
        value: value.slice(start, end),
      },
    };
  }
  if (
    !/^<(?:>|\/(?:>|[A-Za-z_$][\w$-]*(?:[.:][A-Za-z_$][\w$-]*)*(?=[\s>]))|[A-Za-z_$][\w$-]*(?:[.:][A-Za-z_$][\w$-]*)*(?=[\s/{>]))/u.test(
      rest,
    )
  ) {
    const autolink = /^<((?:https?:\/\/|mailto:)[^ <>]+|[^ <>@]+@[^ <>@]+)>/u.exec(rest);
    if (autolink === null) {
      return;
    }
    const end = start + autolink[0].length;
    const label = autolink[1];
    const destination =
      label.includes("@") && !label.startsWith("mailto:") ? `mailto:${label}` : label;
    return {
      end,
      invalid: false,
      node: {
        kind: "link",
        range: input.sourceRange(start, end),
        destination,
        title: undefined,
        children: [textNode(input, value, start + 1, end - 1)],
      },
    };
  }
  const scanner = new JsxBoundaryScanner();
  const structural = scanner.append(rest);
  const end = structural.kind === "open" ? value.length : start + structural.offset;
  if (structural.kind !== "closed") {
    return { end, invalid: true, node: textNode(input, value, start, end) };
  }
  const authored = value.slice(start, end);
  const boundary = parseJavaScriptBoundary(
    "jsxExpression",
    authored,
    input.sourceRange(start, start).start,
  );
  const valid = boundary.kind === "valid";
  return {
    end,
    invalid: !valid,
    node: valid
      ? { kind: "jsx", range: input.sourceRange(start, end), value: authored }
      : textNode(input, value, start, end),
  };
}

function createDelimiter(
  value: string,
  start: number,
  end: number,
  marker: Delimiter["marker"],
): Delimiter {
  const before = value[start - 1];
  const after = value[end];
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

function resolveCloser(
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
    let opener: Delimiter | undefined;
    for (let index = closerIndex - 1; index >= 0; index--) {
      const candidate = delimiters[index];
      if (
        candidate.marker === closer.marker &&
        candidate.canOpen &&
        !violatesRuleOfThree(candidate, closer)
      ) {
        opener = candidate;
        break;
      }
    }
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
    const openerOutput = output.indexOf(opener);
    const closerOutput = output.indexOf(closer);
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
    for (let index = delimiters.length - 1; index >= 0; index--) {
      const delimiter = delimiters[index];
      if (delimiter !== opener && delimiter !== closer && !output.includes(delimiter)) {
        delimiters.splice(index, 1);
      }
    }
    if (opener.length === 0) {
      output.splice(output.indexOf(opener), 1);
      delimiters.splice(delimiters.indexOf(opener), 1);
    }
    if (closer.length === 0) {
      output.splice(output.indexOf(closer), 1);
      delimiters.splice(delimiters.indexOf(closer), 1);
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

function delimiterText(input: InlineInput, delimiter: Delimiter): InlineSyntax {
  return {
    kind: "text",
    range: input.sourceRange(delimiter.start, delimiter.start + delimiter.length),
    value: delimiter.marker.repeat(delimiter.length),
  };
}

function bracketText(input: InlineInput, bracket: Bracket): InlineSyntax {
  const end = bracket.start + (bracket.image ? 2 : 1);
  return {
    kind: "text",
    range: input.sourceRange(bracket.start, end),
    value: bracket.image ? "![" : "[",
  };
}

function isDelimiter(output: Output): output is Delimiter {
  return "marker" in output;
}

function isBracket(output: Output): output is Bracket {
  return "active" in output;
}

function markerRunEnd(value: string, start: number, marker: string): number {
  let end = start;
  while (value[end] === marker) {
    end++;
  }
  return end;
}

function mergeText(nodes: readonly InlineSyntax[]): InlineSyntax[] {
  const merged: InlineSyntax[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (
      previous?.kind === "text" &&
      node.kind === "text" &&
      previous.range.end === node.range.start
    ) {
      merged[merged.length - 1] = {
        kind: "text",
        range: sourceRange(previous.range.start, node.range.end),
        value: previous.value + node.value,
      };
    } else {
      merged.push(node);
    }
  }
  return merged;
}
