import type { SourceRange } from "../ranges.ts";
import type { PhysicalLine } from "../source.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type {
  BlockSyntax,
  OpenLeaf,
  TableAlignmentSyntax,
  TableRowSyntax,
} from "./block-syntax.ts";
import type { InlineSegment } from "./inline-input.ts";
import type { RecognizerResult } from "./recognizer.ts";

import { normalizeIdentifier } from "../identifier.ts";
import { sourceRange } from "../ranges.ts";
import { consumeIndent } from "../utility.ts";
import { findUnescaped, isEscaped, isSpaceOrTab } from "../utility.ts";
import { matched, noMatch } from "./recognizer.ts";

interface RecognizedCompleteBlock {
  readonly kind: "block";
  readonly block: BlockSyntax;
}

interface RecognizedOpenLeaf {
  readonly kind: "openLeaf";
  readonly leaf: Extract<OpenLeaf, { kind: "fencedCode" | "html" }>;
}

type RecognizedBlock = RecognizedCompleteBlock | RecognizedOpenLeaf;

type BlockRecognizer = (source: string, line: PhysicalLine) => RecognizerResult<RecognizedBlock>;

export const recognizeRawHtml: BlockRecognizer = (source, line) => {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  if (indent > 3) {
    return noMatch;
  }
  const value = content.slice(indent);
  const closing = value.startsWith("<!--")
    ? "-->"
    : value.startsWith("<?")
      ? "?>"
      : value.startsWith("<![CDATA[")
        ? "]]>"
        : /^<![A-Z]/u.test(value)
          ? ">"
          : undefined;
  if (closing === undefined) {
    return noMatch;
  }
  const range = sourceRange(line.range.start, line.range.end);
  return value.includes(closing, 2)
    ? matched({
        kind: "block",
        block: { kind: "rawHtml", range },
      })
    : matched({
        kind: "openLeaf",
        leaf: {
          kind: "html",
          start: line.range.start,
          end: line.range.end,
          closing,
        },
      });
};

function matchFrontmatter(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): Extract<OpenLeaf, { kind: "frontmatter" }> | undefined {
  const value = source.slice(line.content.start, line.content.end).trim();
  const format = value === "---" ? "yaml" : value === "+++" ? "toml" : undefined;
  if (format === undefined || !syntax.frontmatter.includes(format)) {
    return;
  }
  return {
    kind: "frontmatter",
    start: line.range.start,
    end: line.range.end,
    valueStart: line.range.end,
    valueEnd: line.range.end,
    format,
    fence: format === "yaml" ? "---" : "+++",
  };
}

export function recognizeFrontmatter(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): RecognizerResult<Extract<OpenLeaf, { kind: "frontmatter" }>> {
  const match = matchFrontmatter(source, line, syntax);
  return match === undefined ? noMatch : matched(match);
}

function matchMathFence(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): Extract<OpenLeaf, { kind: "math" }> | undefined {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  if (indent > 3) {
    return;
  }
  if (syntax.math.includes("tex") && content.slice(indent).trim() === "\\[") {
    return {
      kind: "math",
      start: line.range.start,
      end: line.range.end,
      value: [],
      format: "tex",
      fence: "tex",
      fenceLength: 2,
      meta: undefined,
    };
  }
  if (!syntax.math.includes("dollar") || content[indent] !== "$") {
    return;
  }
  let markerEnd = indent;
  while (content[markerEnd] === "$") {
    markerEnd++;
  }
  const fenceLength = markerEnd - indent;
  if (fenceLength < 2) {
    return;
  }
  let metaStart = markerEnd;
  while (isSpaceOrTab(content[metaStart])) {
    metaStart++;
  }
  return {
    kind: "math",
    start: line.range.start,
    end: line.range.end,
    value: [],
    format: "dollar",
    fence: "dollar",
    fenceLength,
    meta:
      metaStart === content.length
        ? undefined
        : sourceRange(line.content.start + metaStart, line.content.end),
  };
}

export function recognizeMathFence(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): RecognizerResult<Extract<OpenLeaf, { kind: "math" }>> {
  const match = matchMathFence(source, line, syntax);
  return match === undefined ? noMatch : matched(match);
}

function matchSameLineMath(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): Extract<BlockSyntax, { kind: "math" }> | undefined {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  if (indent > 3) {
    return;
  }
  const value = content.slice(indent);
  const trimmed = value.trimEnd();
  if (
    syntax.math.includes("tex") &&
    trimmed.startsWith("\\[") &&
    trimmed.endsWith("\\]") &&
    trimmed.length > 4
  ) {
    return {
      kind: "math",
      range: sourceRange(line.range.start, line.content.end),
      value: [
        {
          kind: "source",
          range: sourceRange(
            line.content.start + indent + 2,
            line.content.start + indent + trimmed.length - 2,
          ),
        },
      ],
      format: "tex",
      meta: undefined,
    };
  }
  if (!syntax.math.includes("dollar") || !value.startsWith("$$")) {
    return;
  }
  let fenceLength = 0;
  while (value[fenceLength] === "$") {
    fenceLength++;
  }
  let closingStart = value.length;
  while (value[closingStart - 1] === "$") {
    closingStart--;
  }
  if (value.length - closingStart < fenceLength || closingStart <= fenceLength) {
    return;
  }
  return {
    kind: "math",
    range: sourceRange(line.range.start, line.content.end),
    value: [
      {
        kind: "source",
        range: sourceRange(
          line.content.start + indent + fenceLength,
          line.content.start + indent + closingStart,
        ),
      },
    ],
    format: "dollar",
    meta: undefined,
  };
}

export function recognizeSameLineMath(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): RecognizerResult<Extract<BlockSyntax, { kind: "math" }>> {
  const match = matchSameLineMath(source, line, syntax);
  return match === undefined ? noMatch : matched(match);
}

export function trimLineEndingOffset(source: string, end: number): number {
  return source[end - 1] === "\n" && source[end - 2] === "\r"
    ? end - 2
    : source[end - 1] === "\n" || source[end - 1] === "\r"
      ? end - 1
      : end;
}

export function isClosingMathFence(
  source: string,
  line: PhysicalLine,
  active: Extract<OpenLeaf, { kind: "math" }>,
): boolean {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  if (indent > 3) {
    return false;
  }
  if (active.fence === "tex") {
    return content.slice(indent).trim() === "\\]";
  }
  let markerEnd = indent;
  while (content[markerEnd] === "$") {
    markerEnd++;
  }
  if (markerEnd - indent < active.fenceLength) {
    return false;
  }
  while (isSpaceOrTab(content[markerEnd])) {
    markerEnd++;
  }
  return markerEnd === content.length;
}

export const recognizeDefinition: BlockRecognizer = (source, line) => {
  const end = line.content.end;
  const indent = consumeIndent(source, line.content.start, end, 3);
  const labelStart = indent.offset;
  if (source[labelStart] !== "[") {
    return noMatch;
  }
  const labelEnd = findUnescaped(source, "]", labelStart + 1, end);
  if (
    labelEnd === undefined ||
    labelEnd === labelStart + 1 ||
    labelEnd - labelStart > 1000 ||
    source[labelEnd + 1] !== ":" ||
    source[labelStart + 1] === "^"
  ) {
    return noMatch;
  }
  let cursor = labelEnd + 2;
  while (cursor < end && isSpaceOrTab(source[cursor])) {
    cursor++;
  }
  const destination = definitionDestination(source, cursor, end);
  if (destination === undefined) {
    return noMatch;
  }
  cursor = destination.next;
  const beforeTitle = cursor;
  while (cursor < end && isSpaceOrTab(source[cursor])) {
    cursor++;
  }
  let title: SourceRange | undefined;
  if (cursor < end) {
    if (cursor === beforeTitle) {
      return noMatch;
    }
    const opener = source[cursor];
    const closer = opener === "(" ? ")" : opener === '"' ? '"' : opener === "'" ? "'" : undefined;
    if (closer === undefined) {
      return noMatch;
    }
    const titleEnd = findUnescaped(source, closer, cursor + 1, end);
    if (titleEnd === undefined) {
      return noMatch;
    }
    title = sourceRange(cursor + 1, titleEnd);
    cursor = titleEnd + 1;
    while (cursor < end && isSpaceOrTab(source[cursor])) {
      cursor++;
    }
  }
  if (cursor !== end) {
    return noMatch;
  }
  return matched({
    kind: "block",
    block: {
      kind: "definition",
      range: sourceRange(line.range.start, line.content.end),
      identifier: normalizeIdentifier(source.slice(labelStart + 1, labelEnd)),
      destination: destination.range,
      title,
    },
  });
};

interface DefinitionDestination {
  readonly range: SourceRange;
  readonly next: number;
}

function definitionDestination(
  source: string,
  start: number,
  end: number,
): DefinitionDestination | undefined {
  if (source[start] === "<") {
    const close = findUnescaped(source, ">", start + 1, end);
    return close === undefined
      ? undefined
      : { range: sourceRange(start + 1, close), next: close + 1 };
  }
  let cursor = start;
  let depth = 0;
  while (cursor < end && !isSpaceOrTab(source[cursor])) {
    const character = source[cursor];
    if (character === "(" && !isEscaped(source, cursor, start)) {
      depth++;
      if (depth > 32) {
        return;
      }
    } else if (character === ")" && !isEscaped(source, cursor, start)) {
      if (depth === 0) {
        break;
      }
      depth--;
    }
    cursor++;
  }
  return cursor === start || depth !== 0
    ? undefined
    : { range: sourceRange(start, cursor), next: cursor };
}

export const recognizeAtxHeading: BlockRecognizer = (source, line) => {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  if (indent > 3 || content[indent] !== "#") {
    return noMatch;
  }
  let markerEnd = indent;
  while (content[markerEnd] === "#") {
    markerEnd++;
  }
  const depth = markerEnd - indent;
  if (depth > 6 || (markerEnd < content.length && !isSpaceOrTab(content[markerEnd]))) {
    return noMatch;
  }
  let valueStart = markerEnd;
  while (isSpaceOrTab(content[valueStart])) {
    valueStart++;
  }
  let valueEnd = content.length;
  while (valueEnd > valueStart && isSpaceOrTab(content[valueEnd - 1])) {
    valueEnd--;
  }
  let closingStart = valueEnd;
  while (content[closingStart - 1] === "#") {
    closingStart--;
  }
  if (
    closingStart < valueEnd &&
    (closingStart === valueStart || isSpaceOrTab(content[closingStart - 1]))
  ) {
    valueEnd = closingStart;
    while (valueEnd > valueStart && isSpaceOrTab(content[valueEnd - 1])) {
      valueEnd--;
    }
  }
  const inputRange = sourceRange(line.content.start + valueStart, line.content.start + valueEnd);
  return matched({
    kind: "block",
    block: {
      kind: "heading",
      range: sourceRange(line.range.start, line.content.end),
      depth: headingDepth(depth),
      input: [{ kind: "source", range: inputRange }],
    },
  });
};

export const recognizeThematicBreak: BlockRecognizer = (source, line) => {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  const marker = content[indent];
  if (indent > 3 || (marker !== "*" && marker !== "-" && marker !== "_")) {
    return noMatch;
  }
  let count = 0;
  for (let index = indent; index < content.length; index++) {
    const character = content[index];
    if (character === marker) {
      count++;
    } else if (!isSpaceOrTab(character)) {
      return noMatch;
    }
  }
  return count < 3
    ? noMatch
    : matched({
        kind: "block",
        block: {
          kind: "thematicBreak",
          range: sourceRange(line.range.start, line.content.end),
        },
      });
};

export const recognizeFence: BlockRecognizer = (source, line) => {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  const marker = content[indent];
  if (indent > 3 || (marker !== "`" && marker !== "~")) {
    return noMatch;
  }
  let markerEnd = indent;
  while (content[markerEnd] === marker) {
    markerEnd++;
  }
  const fenceLength = markerEnd - indent;
  if (fenceLength < 3 || (marker === "`" && content.slice(markerEnd).includes("`"))) {
    return noMatch;
  }
  let infoStart = markerEnd;
  while (isSpaceOrTab(content[infoStart])) {
    infoStart++;
  }
  let languageEnd = infoStart;
  while (languageEnd < content.length && !isSpaceOrTab(content[languageEnd])) {
    languageEnd++;
  }
  let metaStart = languageEnd;
  while (isSpaceOrTab(content[metaStart])) {
    metaStart++;
  }
  return matched({
    kind: "openLeaf",
    leaf: {
      kind: "fencedCode",
      start: line.range.start,
      end: line.range.end,
      value: [],
      marker,
      fenceLength,
      language:
        languageEnd === infoStart
          ? undefined
          : sourceRange(line.content.start + infoStart, line.content.start + languageEnd),
      meta:
        metaStart === content.length
          ? undefined
          : sourceRange(line.content.start + metaStart, line.content.end),
    },
  });
};

export function recognizeTable(
  source: string,
  line: PhysicalLine,
  paragraph: Extract<OpenLeaf, { kind: "paragraph" }>,
): RecognizerResult<Extract<OpenLeaf, { kind: "table" }>> {
  if (paragraph.lines.length !== 1) {
    return noMatch;
  }
  const headerSegment = paragraph.lines[0];
  if (headerSegment.kind !== "source") {
    return noMatch;
  }
  const header = tableRow(source, headerSegment.range);
  const delimiterCells = tableCellRanges(source, line.content);
  if (header.cells.length !== delimiterCells.length || delimiterCells.length === 0) {
    return noMatch;
  }
  const alignments: TableAlignmentSyntax[] = [];
  for (const segments of delimiterCells) {
    const segment = segments[0];
    if (segment?.kind !== "source") {
      return noMatch;
    }
    const value = source.slice(segment.range.start, segment.range.end);
    if (!/^:?-+:?$/u.test(value)) {
      return noMatch;
    }
    alignments.push(
      value.startsWith(":")
        ? value.endsWith(":")
          ? "center"
          : "left"
        : value.endsWith(":")
          ? "right"
          : "none",
    );
  }
  return matched({
    kind: "table",
    start: paragraph.start,
    end: line.range.end,
    alignments: alignments,
    rows: [header],
  });
}

export function tableRow(source: string, range: SourceRange): TableRowSyntax {
  return { range, cells: tableCellRanges(source, range) };
}

function tableCellRanges(
  source: string,
  range: SourceRange,
): readonly (readonly InlineSegment[])[] {
  let start = range.start;
  let end = range.end;
  while (start < end && isSpaceOrTab(source[start])) {
    start++;
  }
  while (end > start && isSpaceOrTab(source[end - 1])) {
    end--;
  }
  if (source[start] === "|") {
    start++;
  }
  if (source[end - 1] === "|" && !isEscaped(source, end - 1, start)) {
    end--;
  }
  const cells: (readonly InlineSegment[])[] = [];
  let cellStart = start;
  let codeFence = 0;
  for (let offset = start; offset <= end; offset++) {
    const character = source[offset];
    if (character === "`" && !isEscaped(source, offset, start)) {
      let runEnd = offset;
      while (source[runEnd] === "`") {
        runEnd++;
      }
      const run = runEnd - offset;
      codeFence = codeFence === 0 ? run : codeFence === run ? 0 : codeFence;
      offset = runEnd - 1;
    }
    if (
      offset === end ||
      (character === "|" && codeFence === 0 && !isEscaped(source, offset, start))
    ) {
      let valueStart = cellStart;
      let valueEnd = offset;
      while (valueStart < valueEnd && isSpaceOrTab(source[valueStart])) {
        valueStart++;
      }
      while (valueEnd > valueStart && isSpaceOrTab(source[valueEnd - 1])) {
        valueEnd--;
      }
      cells.push([{ kind: "source", range: sourceRange(valueStart, valueEnd) }]);
      cellStart = offset + 1;
    }
  }
  return cells;
}

export function recognizeSetext(
  source: string,
  line: PhysicalLine,
  paragraph: Extract<OpenLeaf, { kind: "paragraph" }>,
): RecognizerResult<BlockSyntax> {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  const marker = content[indent];
  if (indent > 3 || (marker !== "=" && marker !== "-")) {
    return noMatch;
  }
  let index = indent;
  while (content[index] === marker) {
    index++;
  }
  while (isSpaceOrTab(content[index])) {
    index++;
  }
  if (index !== content.length) {
    return noMatch;
  }
  return matched({
    kind: "heading",
    range: sourceRange(paragraph.start, line.content.end),
    depth: marker === "=" ? 1 : 2,
    input: paragraph.lines,
  });
}

export function isClosingFence(
  source: string,
  line: PhysicalLine,
  active: Extract<OpenLeaf, { kind: "fencedCode" }>,
): boolean {
  const content = source.slice(line.content.start, line.content.end);
  const indent = leadingIndent(content);
  if (indent > 3 || content[indent] !== active.marker) {
    return false;
  }
  let markerEnd = indent;
  while (content[markerEnd] === active.marker) {
    markerEnd++;
  }
  if (markerEnd - indent < active.fenceLength) {
    return false;
  }
  while (isSpaceOrTab(content[markerEnd])) {
    markerEnd++;
  }
  return markerEnd === content.length;
}

export function interruptsParagraph(source: string, line: PhysicalLine): boolean {
  return [recognizeRawHtml, recognizeFence, recognizeAtxHeading, recognizeThematicBreak].some(
    (recognize) => recognize(source, line).kind === "matched",
  );
}

function headingDepth(value: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6) {
    return value;
  }
  throw new Error(`Invalid ATX heading depth ${value}`);
}

function leadingIndent(value: string): number {
  let index = 0;
  while (value[index] === " ") {
    index++;
  }
  return index;
}
