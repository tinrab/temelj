import type { PhysicalLine } from "../source.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type {
  BlockSyntax,
  ContainerFrame,
  ListItemSyntax,
  OpenLeaf,
  PendingBlockSyntax,
} from "./block-syntax.ts";
import type { InlineSegment } from "./inline-input.ts";
import type { RecognizerResult } from "./recognizer.ts";

import { rangeLength, sourceRange } from "../ranges.ts";
import { consumeIndent } from "../utility.ts";
import { isBlank } from "../utility.ts";
import {
  blockQuoteMarker,
  footnoteMarker,
  isSiblingListItem,
  listMarker,
  taskListMarker,
} from "./block-container-recognizers.ts";
import {
  directiveContainerMarker,
  isClosingDirectiveFence,
  recognizeLeafDirective,
} from "./block-directive-recognizers.ts";
import {
  interruptsParagraph,
  isClosingFence,
  isClosingMathFence,
  recognizeAtxHeading,
  recognizeDefinition,
  recognizeFence,
  recognizeFrontmatter,
  recognizeMathFence,
  recognizeRawHtml,
  recognizeSameLineMath,
  recognizeSetext,
  recognizeTable,
  recognizeThematicBreak,
  tableRow,
  trimLineEndingOffset,
} from "./block-leaf-recognizers.ts";
import { ExpressionBoundaryScanner, JsxBoundaryScanner } from "./embedded-scanner.ts";
import { parseJavaScriptBoundary } from "./javascript-boundary.ts";
import { matched, noMatch } from "./recognizer.ts";

export interface BlockParserCheckpoint {
  readonly blocks: readonly BlockSyntax[];
}

export class BlockParser {
  readonly #blocks: BlockSyntax[] = [];
  readonly #containers: ContainerFrame[] = [];
  readonly #leaf: LeafParser;
  readonly #syntax: ResolvedSyntaxOptions;

  public constructor(
    syntax: ResolvedSyntaxOptions,
    checkpoint: BlockParserCheckpoint = { blocks: [] },
  ) {
    this.#syntax = syntax;
    this.#leaf = new LeafParser(syntax);
    this.#blocks.push(...checkpoint.blocks);
  }

  public checkpoint(): BlockParserCheckpoint | undefined {
    return this.#containers.length === 0 && this.#leaf.idle
      ? { blocks: [...this.#blocks] }
      : undefined;
  }

  public clone(): BlockParser {
    const copy = new BlockParser(this.#syntax);
    copy.#blocks.push(...this.#blocks);
    copy.#containers.push(...this.#containers);
    copy.#leaf.copyFrom(this.#leaf);
    return copy;
  }

  public pending(): PendingBlockSyntax | undefined {
    return this.#leaf.pending();
  }

  public write(source: string, physicalLine: PhysicalLine): void {
    let cursor =
      physicalLine.range.start === 0 && source[0] === "\uFEFF"
        ? physicalLine.content.start + 1
        : physicalLine.content.start;
    let matchedContainers = 0;
    for (const [index, frame] of this.#containers.entries()) {
      if (
        frame.kind === "directiveContainer" &&
        isClosingDirectiveFence(source, physicalLine, cursor, frame.fenceLength)
      ) {
        this.appendLeafBlocks(this.#leaf.finish());
        const current = this.#containers[index];
        if (current.kind !== "directiveContainer") {
          throw new Error("Directive frame changed while closing its leaf");
        }
        this.#containers[index] = { ...current, end: physicalLine.range.end };
        this.closeContainers(index);
        return;
      }
      const continuation = continueContainer(source, physicalLine, cursor, frame);
      if (continuation === undefined) {
        break;
      }
      cursor = continuation;
      matchedContainers = index + 1;
      this.#containers[index] = { ...frame, end: physicalLine.range.end };
    }

    if (matchedContainers === this.#containers.length && this.#leaf.ownsFollowingLine) {
      this.appendLeafBlocks(this.#leaf.write(source, contentLine(physicalLine, cursor)));
      return;
    }

    const unmatched = matchedContainers < this.#containers.length;
    const candidate = contentLine(physicalLine, cursor);
    const unmatchedFrame = this.#containers[matchedContainers];
    const siblingItem =
      unmatchedFrame?.kind === "listItem" && isSiblingListItem(source, candidate, unmatchedFrame);
    const lazy = unmatched && !siblingItem && this.#leaf.canLazyContinue(source, candidate);
    if (lazy) {
      for (let index = matchedContainers; index < this.#containers.length; index++) {
        const frame = this.#containers[index];
        this.#containers[index] = { ...frame, end: physicalLine.range.end };
      }
    }
    if (!lazy) {
      if (unmatched) {
        this.appendLeafBlocks(this.#leaf.finish());
        this.closeContainers(matchedContainers);
      }
      const line = contentLine(physicalLine, cursor);
      if (this.#leaf.hasParagraph) {
        if (opensContainer(source, line, this.#syntax)) {
          this.appendLeafBlocks(this.#leaf.finish());
          cursor = openContainers(source, physicalLine, cursor, this.#containers, this.#syntax);
        }
      } else {
        cursor = openContainers(source, physicalLine, cursor, this.#containers, this.#syntax);
      }
    }
    let line = contentLine(physicalLine, cursor);
    const task = taskListMarker(source, line, this.#containers, this.#leaf.hasParagraph);
    if (task !== undefined) {
      this.#containers[this.#containers.length - 1] = {
        ...task.frame,
        checked: task.checked,
      };
      line = contentLine(physicalLine, task.contentStart);
    }
    if (isBlank(source.slice(line.content.start, line.content.end))) {
      markListBlank(this.#containers);
    }
    const allowFrontmatter =
      physicalLine.line === 1 && this.#blocks.length === 0 && this.#containers.length === 0;
    this.appendLeafBlocks(this.#leaf.write(source, line, allowFrontmatter));
  }

  public finish(source: string): readonly BlockSyntax[] {
    this.appendLeafBlocks(this.#leaf.finish(source));
    this.closeContainers(0);
    return [...this.#blocks];
  }

  private appendLeafBlocks(blocks: readonly BlockSyntax[]): void {
    for (const block of blocks) {
      appendBlock(this.#blocks, this.#containers, block);
    }
  }

  private closeContainers(keep: number): void {
    while (this.#containers.length > keep) {
      const frame = this.#containers.pop();
      if (frame === undefined) {
        throw new Error("Container stack changed while closing a frame");
      }
      if (frame.kind === "blockQuote") {
        appendBlock(this.#blocks, this.#containers, {
          kind: "blockQuote",
          range: sourceRange(frame.start, frame.end),
          children: frame.children,
        });
      } else if (frame.kind === "listItem") {
        appendListItem(this.#blocks, this.#containers, frame);
      } else if (frame.kind === "footnoteDefinition") {
        appendBlock(this.#blocks, this.#containers, {
          kind: "footnoteDefinition",
          range: sourceRange(frame.start, frame.end),
          identifier: frame.identifier,
          children: frame.children,
        });
      } else if (frame.kind === "directiveContainer") {
        appendBlock(this.#blocks, this.#containers, {
          kind: "directive",
          range: sourceRange(frame.start, frame.end),
          name: frame.name,
          label: frame.label,
          attributes: frame.attributes,
          children: frame.children,
        });
      }
    }
  }
}

class LeafParser {
  readonly #syntax: ResolvedSyntaxOptions;
  #active: OpenLeaf | undefined;
  #expressionScanner: ExpressionBoundaryScanner | undefined;
  #jsxScanner: JsxBoundaryScanner | undefined;

  public constructor(syntax: ResolvedSyntaxOptions) {
    this.#syntax = syntax;
  }

  public get hasParagraph(): boolean {
    return this.#active?.kind === "paragraph";
  }

  public get idle(): boolean {
    return this.#active === undefined;
  }

  public get ownsFollowingLine(): boolean {
    const kind = this.#active?.kind;
    return (
      kind === "fencedCode" ||
      kind === "html" ||
      kind === "frontmatter" ||
      kind === "math" ||
      kind === "expression" ||
      kind === "jsx" ||
      kind === "esm"
    );
  }

  public copyFrom(source: LeafParser): void {
    this.#active = source.#active;
    this.#expressionScanner = source.#expressionScanner?.clone();
    this.#jsxScanner = source.#jsxScanner?.clone();
  }

  public pending(): PendingBlockSyntax | undefined {
    const active = this.#active;
    if (active === undefined) {
      return;
    }
    if (active.kind === "paragraph") {
      return {
        kind: "paragraph",
        range: sourceRange(active.start, active.end),
        input: active.lines,
      };
    }
    if (active.kind === "fencedCode") {
      return {
        kind: "fencedCode",
        range: sourceRange(active.start, active.end),
        value: active.value,
        language: active.language,
      };
    }
    if (active.kind === "math") {
      return {
        kind: "math",
        range: sourceRange(active.start, active.end),
        value: active.value,
        format: active.format,
      };
    }
    if (active.kind === "jsx" || active.kind === "expression" || active.kind === "esm") {
      return {
        kind: active.kind,
        range: sourceRange(active.start, active.end),
      };
    }
    return;
  }

  public canLazyContinue(source: string, line: PhysicalLine): boolean {
    return (
      this.#active?.kind === "paragraph" &&
      !isBlank(source.slice(line.content.start, line.content.end)) &&
      !this.interruptsParagraph(source, line) &&
      !opensContainer(source, line, this.#syntax)
    );
  }

  public write(
    source: string,
    line: PhysicalLine,
    allowFrontmatter = false,
  ): readonly BlockSyntax[] {
    const blocks: BlockSyntax[] = [];
    if (this.#active?.kind === "expression" || this.#active?.kind === "jsx") {
      const active = this.#active;
      const segment: InlineSegment = {
        kind: "source",
        range: sourceRange(line.content.start, line.range.end),
      };
      const scanner = active.kind === "expression" ? this.#expressionScanner : this.#jsxScanner;
      if (scanner === undefined) {
        throw new Error(`Missing retained scanner for ${active.kind}`);
      }
      const result = scanner.append(source.slice(line.range.start, line.range.end));
      this.#active = {
        ...active,
        end: line.range.end,
        value: [...active.value, segment],
      };
      if (result.kind !== "open") {
        blocks.push(this.finishEmbedded(source, result.kind === "invalid"));
      }
      return blocks;
    }
    if (this.#active?.kind === "esm") {
      const content = source.slice(line.content.start, line.content.end);
      if (isBlank(content)) {
        blocks.push(this.finishEmbedded(source));
        return blocks;
      }
      this.#active = {
        ...this.#active,
        end: line.range.end,
        value: [
          ...this.#active.value,
          {
            kind: "source",
            range: sourceRange(line.content.start, line.range.end),
          },
        ],
      };
      return blocks;
    }
    if (this.#active?.kind === "html") {
      const active = this.#active;
      if (source.slice(line.content.start, line.content.end).includes(active.closing)) {
        blocks.push(this.closeActive(line.range.end));
      } else {
        this.#active = { ...active, end: line.range.end };
      }
      return blocks;
    }
    if (this.#active?.kind === "frontmatter") {
      if (source.slice(line.content.start, line.content.end).trim() === this.#active.fence) {
        blocks.push(this.closeActive(line.range.end));
      } else {
        this.#active = {
          ...this.#active,
          end: line.range.end,
          valueEnd: line.range.end,
        };
      }
      return blocks;
    }
    if (this.#active?.kind === "math") {
      if (isClosingMathFence(source, line, this.#active)) {
        blocks.push(this.closeActive(line.range.end));
      } else {
        this.#active = {
          ...this.#active,
          end: line.range.end,
          value: [...this.#active.value, { kind: "source", range: line.range }],
        };
      }
      return blocks;
    }
    if (this.#active?.kind === "fencedCode") {
      if (isClosingFence(source, line, this.#active)) {
        blocks.push(this.closeActive(line.range.end));
      } else {
        this.#active = {
          ...this.#active,
          end: line.range.end,
          value: [...this.#active.value, { kind: "source", range: line.range }],
        };
      }
      return blocks;
    }

    if (this.#active?.kind === "indentedCode") {
      const active = this.#active;
      const content = source.slice(line.content.start, line.content.end);
      if (isBlank(content)) {
        this.#active = {
          ...active,
          end: line.range.end,
          pendingBlank: [
            ...active.pendingBlank,
            {
              kind: "source",
              range: sourceRange(line.content.end, line.range.end),
            },
          ],
        };
        return blocks;
      }
      const indented = indentedCodeLine(source, line);
      if (indented !== undefined) {
        this.#active = {
          ...active,
          end: line.range.end,
          value: [...active.value, ...active.pendingBlank, ...indented],
          pendingBlank: [],
        };
        return blocks;
      }
      blocks.push(this.closeActive());
    }

    if (this.#active?.kind === "table") {
      const content = source.slice(line.content.start, line.content.end);
      if (isBlank(content)) {
        blocks.push(this.closeActive());
      } else {
        const row = tableRow(source, line.content);
        this.#active = {
          ...this.#active,
          end: line.range.end,
          rows: [...this.#active.rows, row],
        };
        return blocks;
      }
    }

    const content = source.slice(line.content.start, line.content.end);
    if (isBlank(content)) {
      return [...blocks, ...this.finish()];
    }

    if (this.#active?.kind === "paragraph") {
      const setext = recognizeSetext(source, line, this.#active);
      if (setext.kind === "matched") {
        blocks.push(setext.value);
        this.#active = undefined;
        return blocks;
      }
      const table = recognizeTable(source, line, this.#active);
      if (table.kind === "matched") {
        this.#active = table.value;
        return blocks;
      }
      if (!this.interruptsParagraph(source, line)) {
        this.#active = {
          kind: "paragraph",
          start: this.#active.start,
          end: line.content.end,
          lines: [
            ...this.#active.lines,
            { kind: "source", range: this.#active.pendingEnding },
            { kind: "source", range: line.content },
          ],
          pendingEnding: sourceRange(line.content.end, line.range.end),
        };
        return blocks;
      }
      blocks.push(this.closeActive());
    }

    if (allowFrontmatter) {
      const frontmatter = recognizeFrontmatter(source, line, this.#syntax);
      if (frontmatter.kind === "matched") {
        this.#active = frontmatter.value;
        return blocks;
      }
    }

    const leafDirective = recognizeLeafDirective(source, line, this.#syntax);
    if (leafDirective.kind === "matched") {
      blocks.push(leafDirective.value);
      return blocks;
    }

    const sameLineMath = recognizeSameLineMath(source, line, this.#syntax);
    if (sameLineMath.kind === "matched") {
      blocks.push(sameLineMath.value);
      return blocks;
    }

    const math = recognizeMathFence(source, line, this.#syntax);
    if (math.kind === "matched") {
      this.#active = math.value;
      return blocks;
    }

    const embedded = recognizeEmbeddedFlowStart(source, line);
    if (embedded.kind === "matched") {
      const segment: InlineSegment = {
        kind: "source",
        range: sourceRange(line.content.start, line.range.end),
      };
      this.#active = {
        kind: embedded.value.kind,
        start: line.content.start,
        end: line.range.end,
        value: [segment],
      };
      if (embedded.value.kind === "esm") {
        return blocks;
      }
      const start =
        embedded.value.kind === "expression" ? embedded.value.markerEnd : line.content.start;
      if (embedded.value.kind === "expression") {
        const scanner = new ExpressionBoundaryScanner();
        this.#expressionScanner = scanner;
        const result = scanner.append(source.slice(start, line.range.end));
        if (result.kind !== "open") {
          blocks.push(this.finishEmbedded(source, result.kind === "invalid"));
        }
      } else {
        const scanner = new JsxBoundaryScanner();
        this.#jsxScanner = scanner;
        const result = scanner.append(source.slice(start, line.range.end));
        if (result.kind !== "open") {
          blocks.push(this.finishEmbedded(source, result.kind === "invalid"));
        }
      }
      return blocks;
    }

    for (const recognize of [
      recognizeRawHtml,
      recognizeDefinition,
      recognizeFence,
      recognizeAtxHeading,
      recognizeThematicBreak,
    ]) {
      const result = recognize(source, line);
      if (result.kind === "matched") {
        if (result.value.kind === "openLeaf") {
          this.#active = result.value.leaf;
        } else {
          blocks.push(result.value.block);
        }
        return blocks;
      }
    }

    const indented = indentedCodeLine(source, line);
    if (indented !== undefined) {
      this.#active = {
        kind: "indentedCode",
        start: line.range.start,
        end: line.range.end,
        value: indented,
        pendingBlank: [],
      };
      return blocks;
    }

    this.#active = {
      kind: "paragraph",
      start: line.content.start,
      end: line.content.end,
      lines: [{ kind: "source", range: line.content }],
      pendingEnding: sourceRange(line.content.end, line.range.end),
    };
    return blocks;
  }

  public finish(source?: string): readonly BlockSyntax[] {
    if (this.#active?.kind === "esm" && source !== undefined) {
      return [this.finishEmbedded(source)];
    }
    if (this.#active?.kind === "frontmatter" && source !== undefined) {
      const active = this.#active;
      this.#active = undefined;
      const contentEnd = trimLineEndingOffset(source, active.valueEnd);
      const paragraphStart = active.format === "yaml" ? active.valueStart : active.start;
      const fallback: BlockSyntax[] = [];
      if (active.format === "yaml") {
        fallback.push({
          kind: "thematicBreak",
          range: sourceRange(active.start, trimLineEndingOffset(source, active.valueStart)),
        });
      }
      if (contentEnd > paragraphStart) {
        fallback.push({
          kind: "paragraph",
          range: sourceRange(paragraphStart, contentEnd),
          input: [{ kind: "source", range: sourceRange(paragraphStart, contentEnd) }],
        });
      }
      return fallback;
    }
    if (
      this.#active?.kind === "expression" ||
      this.#active?.kind === "jsx" ||
      this.#active?.kind === "esm"
    ) {
      const active = this.#active;
      this.#active = undefined;
      this.#expressionScanner = undefined;
      this.#jsxScanner = undefined;
      return [
        {
          kind: "invalidMdx",
          range: sourceRange(active.start, active.end),
          syntax: active.kind,
          state: "incomplete",
        },
      ];
    }
    return this.#active === undefined ? [] : [this.closeActive()];
  }

  private finishEmbedded(source: string, structurallyInvalid = false): BlockSyntax {
    const active = this.#active;
    if (active?.kind !== "expression" && active?.kind !== "jsx" && active?.kind !== "esm") {
      throw new Error("Cannot finish a missing embedded flow leaf");
    }
    this.#active = undefined;
    this.#expressionScanner = undefined;
    this.#jsxScanner = undefined;
    const authored = segmentsText(source, active.value);
    const javascript =
      active.kind === "expression"
        ? authored.slice(authored.indexOf("{") + 1, authored.lastIndexOf("}"))
        : authored;
    const boundary =
      structurallyInvalid || (active.kind === "expression" && javascript.trim() === "")
        ? undefined
        : parseJavaScriptBoundary(
            active.kind === "jsx" ? "jsxExpression" : active.kind,
            javascript,
            active.kind === "expression" ? active.start + authored.indexOf("{") + 1 : active.start,
          );
    const valid =
      !structurallyInvalid &&
      ((active.kind === "expression" && javascript.trim() === "") || boundary?.kind === "valid");
    return valid
      ? { kind: active.kind, range: sourceRange(active.start, active.end) }
      : {
          kind: "invalidMdx",
          range: sourceRange(active.start, active.end),
          syntax: active.kind,
          state: boundary?.kind === "incompleteAtPhysicalEof" ? "incomplete" : "invalid",
        };
  }

  private closeActive(end?: number): BlockSyntax {
    const active = this.#active;
    if (active === undefined) {
      throw new Error("Cannot close a missing leaf");
    }
    this.#active = undefined;
    if (active.kind === "paragraph") {
      return {
        kind: "paragraph",
        range: sourceRange(active.start, active.end),
        input: active.lines,
      };
    }
    if (active.kind === "fencedCode") {
      return {
        kind: "code",
        range: sourceRange(active.start, end ?? active.end),
        value: active.value,
        fenced: true,
        language: active.language,
        meta: active.meta,
      };
    }
    if (active.kind === "indentedCode") {
      return {
        kind: "code",
        range: sourceRange(active.start, active.end),
        value: active.value,
        fenced: false,
        language: undefined,
        meta: undefined,
      };
    }
    if (active.kind === "table") {
      return {
        kind: "table",
        range: sourceRange(active.start, active.end),
        alignments: active.alignments,
        rows: active.rows,
      };
    }
    if (active.kind === "frontmatter") {
      return {
        kind: "frontmatter",
        range: sourceRange(active.start, end ?? active.end),
        value: sourceRange(active.valueStart, active.valueEnd),
        format: active.format,
      };
    }
    if (active.kind === "math") {
      return {
        kind: "math",
        range: sourceRange(active.start, end ?? active.end),
        value: active.value,
        format: active.format,
        meta: active.meta,
      };
    }
    if (active.kind === "html") {
      return {
        kind: "rawHtml",
        range: sourceRange(active.start, end ?? active.end),
      };
    }
    throw new Error(`Cannot close unimplemented ${active.kind} leaf`);
  }

  private interruptsParagraph(source: string, line: PhysicalLine): boolean {
    return (
      interruptsParagraph(source, line) ||
      recognizeLeafDirective(source, line, this.#syntax).kind === "matched" ||
      recognizeSameLineMath(source, line, this.#syntax).kind === "matched" ||
      recognizeMathFence(source, line, this.#syntax).kind === "matched" ||
      recognizeEmbeddedFlowStart(source, line).kind === "matched"
    );
  }
}

interface EmbeddedFlowStart {
  readonly kind: "esm" | "expression" | "jsx";
  readonly markerEnd: number;
}

function matchEmbeddedFlowStart(source: string, line: PhysicalLine): EmbeddedFlowStart | undefined {
  const start = consumeIndent(source, line.content.start, line.content.end, 3).offset;
  const content = source.slice(start, line.content.end);
  if (content.startsWith("{")) {
    return { kind: "expression", markerEnd: start + 1 };
  }
  if (
    /^<(?:>|\/(?:>|[A-Za-z_$][\w$-]*(?:[.:][A-Za-z_$][\w$-]*)*(?=[\s>]|$))|[A-Za-z_$][\w$-]*(?:[.:][A-Za-z_$][\w$-]*)*(?=[\s/{>]|$))/u.test(
      content,
    )
  ) {
    return { kind: "jsx", markerEnd: start + 1 };
  }
  if (/^(?:import\s|export(?:\s|\{))/u.test(content)) {
    return { kind: "esm", markerEnd: start };
  }
  return;
}

function recognizeEmbeddedFlowStart(
  source: string,
  line: PhysicalLine,
): RecognizerResult<EmbeddedFlowStart> {
  const match = matchEmbeddedFlowStart(source, line);
  return match === undefined ? noMatch : matched(match);
}

function segmentsText(source: string, segments: readonly InlineSegment[]): string {
  let value = "";
  for (const segment of segments) {
    value +=
      segment.kind === "source"
        ? source.slice(segment.range.start, segment.range.end)
        : " ".repeat(segment.columns);
  }
  return value;
}

function appendBlock(root: BlockSyntax[], containers: ContainerFrame[], block: BlockSyntax): void {
  const parent = containers.at(-1);
  if (parent === undefined) {
    root.push(block);
    return;
  }
  if (parent.kind === "directiveContainer") {
    const children = [...parent.children, block];
    containers[containers.length - 1] = { ...parent, children };
    return;
  }
  const children = [...parent.children, block];
  const index = containers.length - 1;
  containers[index] = { ...parent, children: children };
}

function appendListItem(
  root: BlockSyntax[],
  containers: ContainerFrame[],
  frame: Extract<ContainerFrame, { kind: "listItem" }>,
): void {
  const item: ListItemSyntax = {
    range: sourceRange(frame.rangeStart, frame.end),
    checked: frame.checked,
    spread: frame.spread,
    children: frame.children,
  };
  const parent = containers.at(-1);
  const siblings = parent === undefined ? root : [...parent.children];
  const previous = siblings.at(-1);
  if (
    previous?.kind === "list" &&
    previous.ordered === frame.ordered &&
    previous.marker === frame.markerCharacter
  ) {
    siblings[siblings.length - 1] = {
      ...previous,
      range: sourceRange(previous.range.start, frame.end),
      spread: previous.spread || frame.spread,
      items: [...previous.items, item],
    };
  } else {
    siblings.push({
      kind: "list",
      range: sourceRange(frame.rangeStart, frame.end),
      ordered: frame.ordered,
      start: frame.start,
      spread: frame.spread,
      marker: frame.markerCharacter,
      items: [item],
    });
  }
  if (parent === undefined) {
    root.splice(0, root.length, ...siblings);
  } else {
    containers[containers.length - 1] = {
      ...parent,
      children: siblings,
    };
  }
}

function continueContainer(
  source: string,
  line: PhysicalLine,
  cursor: number,
  frame: ContainerFrame,
): number | undefined {
  if (frame.kind === "blockQuote") {
    const marker = blockQuoteMarker(source, line.content.end, cursor);
    return marker?.contentStart;
  }
  if (frame.kind === "listItem") {
    if (isBlank(source.slice(cursor, line.content.end))) {
      return line.content.end;
    }
    return consumeColumns(source, cursor, line.content.end, frame.contentIndent);
  }
  if (frame.kind === "footnoteDefinition") {
    if (isBlank(source.slice(cursor, line.content.end))) {
      return line.content.end;
    }
    return consumeColumns(source, cursor, line.content.end, frame.contentIndent);
  }
  if (frame.kind === "directiveContainer") {
    return cursor;
  }
  return;
}

function openContainers(
  source: string,
  line: PhysicalLine,
  initialCursor: number,
  containers: ContainerFrame[],
  syntax: ResolvedSyntaxOptions,
): number {
  let cursor = initialCursor;
  while (cursor < line.content.end) {
    const quote = blockQuoteMarker(source, line.content.end, cursor);
    if (quote !== undefined) {
      containers.push({
        kind: "blockQuote",
        marker: sourceRange(quote.markerStart, quote.markerEnd),
        contentIndent: quote.contentStart - quote.markerEnd,
        start: quote.markerStart,
        end: line.range.end,
        children: [],
      });
      cursor = quote.contentStart;
      continue;
    }
    const footnote = footnoteMarker(source, line.content.end, cursor);
    if (footnote !== undefined) {
      containers.push({
        kind: "footnoteDefinition",
        marker: sourceRange(footnote.markerStart, footnote.markerEnd),
        identifier: footnote.identifier,
        contentIndent: 4,
        start: footnote.markerStart,
        end: line.range.end,
        children: [],
      });
      cursor = footnote.contentStart;
      continue;
    }
    const directive = syntax.directives
      ? directiveContainerMarker(source, line.content.end, cursor)
      : undefined;
    if (directive !== undefined) {
      containers.push({
        kind: "directiveContainer",
        marker: sourceRange(directive.markerStart, directive.markerEnd),
        name: directive.name,
        fenceLength: directive.fenceLength,
        start: directive.markerStart,
        end: line.range.end,
        children: [],
        label: directive.label,
        attributes: directive.attributes,
      });
      cursor = line.content.end;
      continue;
    }
    const adjusted = contentLine(line, cursor);
    if (recognizeThematicBreak(source, adjusted).kind === "matched") {
      break;
    }
    const list = listMarker(source, line.content.end, cursor);
    if (list === undefined) {
      break;
    }
    containers.push({
      kind: "listItem",
      marker: sourceRange(list.markerStart, list.markerEnd),
      markerCharacter: list.markerCharacter,
      contentIndent: list.contentIndent,
      ordered: list.ordered,
      start: list.start,
      checked: undefined,
      spread: false,
      rangeStart: list.markerStart,
      end: line.range.end,
      children: [],
    });
    cursor = list.contentStart;
  }
  return cursor;
}

function opensContainer(
  source: string,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): boolean {
  return (
    blockQuoteMarker(source, line.content.end, line.content.start) !== undefined ||
    footnoteMarker(source, line.content.end, line.content.start) !== undefined ||
    (syntax.directives &&
      directiveContainerMarker(source, line.content.end, line.content.start) !== undefined) ||
    (recognizeThematicBreak(source, line).kind !== "matched" &&
      listMarker(source, line.content.end, line.content.start, true) !== undefined)
  );
}

function consumeColumns(
  source: string,
  start: number,
  end: number,
  required: number,
): number | undefined {
  const indent = consumeIndent(source, start, end, required);
  return indent.columns >= required ? indent.offset : undefined;
}

function indentedCodeLine(
  source: string,
  line: PhysicalLine,
): readonly InlineSegment[] | undefined {
  const contentStart = consumeColumns(source, line.content.start, line.content.end, 4);
  return contentStart === undefined
    ? undefined
    : [
        {
          kind: "source",
          range: sourceRange(contentStart, line.range.end),
        },
      ];
}

function markListBlank(containers: ContainerFrame[]): void {
  for (const [index, frame] of containers.entries()) {
    if (frame.kind === "listItem" && !frame.spread) {
      containers[index] = { ...frame, spread: true };
    }
  }
}

function contentLine(line: PhysicalLine, contentStart: number): PhysicalLine {
  return {
    line: line.line,
    range: sourceRange(contentStart, line.range.end),
    content: sourceRange(contentStart, line.content.end),
    ending: line.ending,
  };
}

export function blockLength(block: BlockSyntax): number {
  return rangeLength(block.range);
}
