import type { PhysicalLine } from "../source.ts";
import type { ContainerFrame } from "./block-syntax.ts";

import { normalizeIdentifier } from "../identifier.ts";
import { consumeIndent } from "../utility.ts";
import { findUnescaped, isAsciiDigit, isSpaceOrTab } from "../utility.ts";

export interface QuoteMarker {
  readonly markerStart: number;
  readonly markerEnd: number;
  readonly contentStart: number;
}

export function blockQuoteMarker(
  source: string,
  end: number,
  start: number,
): QuoteMarker | undefined {
  const indent = consumeIndent(source, start, end, 3);
  if (source[indent.offset] !== ">") {
    return;
  }
  const markerEnd = indent.offset + 1;
  const contentStart = isSpaceOrTab(source[markerEnd]) ? markerEnd + 1 : markerEnd;
  return { markerStart: start, markerEnd, contentStart };
}

export interface FootnoteMarker {
  readonly markerStart: number;
  readonly markerEnd: number;
  readonly contentStart: number;
  readonly identifier: string;
}

export function footnoteMarker(
  source: string,
  end: number,
  start: number,
): FootnoteMarker | undefined {
  const indent = consumeIndent(source, start, end, 3);
  const markerStart = start;
  const labelStart = indent.offset;
  if (source.slice(labelStart, labelStart + 2) !== "[^") {
    return;
  }
  const labelEnd = findUnescaped(source, "]", labelStart + 2, end);
  if (labelEnd === undefined || source[labelEnd + 1] !== ":" || labelEnd === labelStart + 2) {
    return;
  }
  const markerEnd = labelEnd + 2;
  let contentStart = markerEnd;
  while (contentStart < end && isSpaceOrTab(source[contentStart])) {
    contentStart++;
  }
  return {
    markerStart,
    markerEnd,
    contentStart,
    identifier: normalizeIdentifier(source.slice(labelStart + 2, labelEnd)),
  };
}

export interface ListMarker {
  readonly markerStart: number;
  readonly markerEnd: number;
  readonly markerCharacter: "." | ")" | "*" | "+" | "-";
  readonly ordered: boolean;
  readonly start: number | undefined;
  readonly contentIndent: number;
  readonly contentStart: number;
}

export function listMarker(
  source: string,
  end: number,
  start: number,
  interruptingParagraph = false,
): ListMarker | undefined {
  const indent = consumeIndent(source, start, end, 3);
  let offset = indent.offset;
  const first = source[offset];
  let markerCharacter: ListMarker["markerCharacter"];
  let ordered = false;
  let listStart: number | undefined;
  if (first === "*" || first === "+" || first === "-") {
    markerCharacter = first;
    offset++;
  } else {
    const numberStart = offset;
    while (offset < end && offset - numberStart < 9 && isAsciiDigit(source[offset])) {
      offset++;
    }
    const delimiter = source[offset];
    if (offset === numberStart || (delimiter !== "." && delimiter !== ")")) {
      return;
    }
    listStart = Number(source.slice(numberStart, offset));
    if (interruptingParagraph && listStart !== 1) {
      return;
    }
    markerCharacter = delimiter;
    ordered = true;
    offset++;
  }
  if (offset < end && !isSpaceOrTab(source[offset])) {
    return;
  }
  const markerEnd = offset;
  const padding = consumeIndent(source, offset, end, 4);
  const contentIndent =
    padding.columns === 0 || padding.columns > 4
      ? markerEnd - start + 1
      : markerEnd - start + padding.columns;
  const contentStart = padding.columns === 0 ? markerEnd : padding.offset;
  return {
    markerStart: start,
    markerEnd,
    markerCharacter,
    ordered,
    start: listStart,
    contentIndent,
    contentStart,
  };
}

export function isSiblingListItem(
  source: string,
  line: PhysicalLine,
  frame: Extract<ContainerFrame, { kind: "listItem" }>,
): boolean {
  const marker = listMarker(source, line.content.end, line.content.start);
  return (
    marker !== undefined &&
    marker.ordered === frame.ordered &&
    marker.markerCharacter === frame.markerCharacter
  );
}

export interface TaskMarker {
  readonly checked: boolean;
  readonly contentStart: number;
  readonly frame: Extract<ContainerFrame, { kind: "listItem" }>;
}

export function taskListMarker(
  source: string,
  line: PhysicalLine,
  containers: readonly ContainerFrame[],
  continuingParagraph: boolean,
): TaskMarker | undefined {
  const frame = containers.at(-1);
  if (
    continuingParagraph ||
    frame?.kind !== "listItem" ||
    frame.checked !== undefined ||
    frame.children.length > 0
  ) {
    return;
  }
  const start = line.content.start;
  const marker = source.slice(start, start + 3);
  if (marker !== "[ ]" && marker.toLowerCase() !== "[x]") {
    return;
  }
  const after = source[start + 3];
  if (start + 3 < line.content.end && !isSpaceOrTab(after)) {
    return;
  }
  let contentStart = start + 3;
  while (contentStart < line.content.end && isSpaceOrTab(source[contentStart])) {
    contentStart++;
  }
  return { checked: marker !== "[ ]", contentStart, frame };
}
