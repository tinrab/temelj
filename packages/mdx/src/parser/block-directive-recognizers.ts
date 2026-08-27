import type { PhysicalLine } from "../source.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { BlockSyntax, DirectiveAttributeSyntax } from "./block-syntax.ts";
import type { InlineSegment } from "./inline-input.ts";
import type { RecognizerResult } from "./recognizer.ts";

import { sourceRange } from "../ranges.ts";
import { consumeIndent } from "../utility.ts";
import { findUnescaped, isBlank, isSpaceOrTab } from "../utility.ts";
import { matched, noMatch } from "./recognizer.ts";

export interface DirectiveContainerMarker {
  readonly attributes: readonly DirectiveAttributeSyntax[];
  readonly fenceLength: number;
  readonly label: readonly InlineSegment[] | undefined;
  readonly markerEnd: number;
  readonly markerStart: number;
  readonly name: string;
}

export function directiveContainerMarker(
  source: string,
  end: number,
  start: number,
): DirectiveContainerMarker | undefined {
  const markerStart = consumeIndent(source, start, end, 3).offset;
  let markerEnd = markerStart;
  while (source[markerEnd] === ":") {
    markerEnd++;
  }
  if (markerEnd - markerStart < 3) {
    return;
  }
  const name = /^[A-Za-z][\w-]*/u.exec(source.slice(markerEnd, end))?.[0];
  if (name === undefined) {
    return;
  }
  const tail = directiveTail(source, markerEnd + name.length, end);
  if (tail === undefined) {
    return;
  }
  return {
    attributes: tail.attributes,
    fenceLength: markerEnd - markerStart,
    label: tail.label,
    markerEnd,
    markerStart,
    name,
  };
}

interface DirectiveTail {
  readonly attributes: readonly DirectiveAttributeSyntax[];
  readonly label: readonly InlineSegment[] | undefined;
}

function directiveTail(source: string, start: number, end: number): DirectiveTail | undefined {
  let cursor = start;
  let label: readonly InlineSegment[] | undefined;
  if (source[cursor] === "[") {
    const close = findUnescaped(source, "]", cursor + 1, end);
    if (close === undefined) {
      return;
    }
    label = [{ kind: "source", range: sourceRange(cursor + 1, close) }];
    cursor = close + 1;
  }
  let attributes: readonly DirectiveAttributeSyntax[] = [];
  if (source[cursor] === "{") {
    const close = findUnescaped(source, "}", cursor + 1, end);
    if (close === undefined) {
      return;
    }
    attributes = parseDirectiveAttributes(source.slice(cursor + 1, close));
    cursor = close + 1;
  }
  while (cursor < end && isSpaceOrTab(source[cursor])) {
    cursor++;
  }
  return cursor === end ? { attributes, label } : undefined;
}

function parseDirectiveAttributes(source: string): readonly DirectiveAttributeSyntax[] {
  const attributes: DirectiveAttributeSyntax[] = [];
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

function matchLeafDirective(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): Extract<BlockSyntax, { kind: "leafDirective" }> | undefined {
  if (!syntax.directives) {
    return;
  }
  const start = consumeIndent(source, line.content.start, line.content.end, 3).offset;
  if (!source.startsWith("::", start) || source[start + 2] === ":") {
    return;
  }
  const name = /^[A-Za-z][\w-]*/u.exec(source.slice(start + 2, line.content.end))?.[0];
  if (name === undefined) {
    return;
  }
  const tail = directiveTail(source, start + 2 + name.length, line.content.end);
  return tail === undefined
    ? undefined
    : {
        kind: "leafDirective",
        range: sourceRange(line.range.start, line.content.end),
        name,
        label: tail.label,
        attributes: tail.attributes,
      };
}

export function recognizeLeafDirective(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): RecognizerResult<Extract<BlockSyntax, { kind: "leafDirective" }>> {
  const match = matchLeafDirective(source, line, syntax);
  return match === undefined ? noMatch : matched(match);
}

export function isClosingDirectiveFence(
  source: string,
  line: PhysicalLine,
  start: number,
  minimumFenceLength: number,
): boolean {
  const markerStart = consumeIndent(source, start, line.content.end, 3).offset;
  let markerEnd = markerStart;
  while (source[markerEnd] === ":") {
    markerEnd++;
  }
  return (
    markerEnd - markerStart >= minimumFenceLength &&
    isBlank(source.slice(markerEnd, line.content.end))
  );
}
