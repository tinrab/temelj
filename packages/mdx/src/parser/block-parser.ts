import type { SourceRange } from "../ranges.ts";
import type { SourceText } from "../source-text.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type {
  BlockSyntax,
  ContainerFrame,
  ListItemSyntax,
  ListSyntax,
  OpenExpression,
  OpenIndentedCode,
  OpenJsx,
  OpenLeaf,
  OpenTable,
  PendingBlockSyntax,
} from "./block-syntax.ts";
import type { InlineSegment } from "./inline-input.ts";
import type { RecognizerResult } from "./recognizer.ts";

import { sourceRange } from "../ranges.ts";
import { PhysicalLineScanner, type PhysicalLine } from "../source.ts";
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
import { consumeIndent, isAsciiLetter, isBlank, isSpaceOrTab } from "./characters.ts";
import { JsxBoundaryScanner } from "./embedded-scanner.ts";
import { parseJavaScriptBoundary } from "./javascript-boundary.ts";
import { JavaScriptScanner } from "./javascript-scanner.ts";
import { matched, noMatch } from "./recognizer.ts";

export interface BlockParserCheckpoint {
  readonly length: number;
  readonly tail: BlockSyntax | undefined;
}

/** Receives each top-level block once later input can no longer change it. */
export type SettledBlockListener = (block: BlockSyntax, index: number) => void;

export class BlockParser {
  readonly #blocks: BlockSyntax[] = [];
  readonly #containers: ContainerFrame[] = [];
  readonly #leaf: LeafParser;
  readonly #syntax: ResolvedSyntaxOptions;
  readonly #onSettled: SettledBlockListener | undefined;
  #settled: number;
  readonly #items: ListItemGrowth = { draft: false, owned: new WeakMap() };

  public constructor(
    syntax: ResolvedSyntaxOptions,
    blocks: readonly BlockSyntax[] = [],
    onSettled?: SettledBlockListener,
  ) {
    this.#syntax = syntax;
    this.#leaf = new LeafParser(syntax);
    this.#blocks.push(...blocks);
    this.#onSettled = onSettled;
    this.#settled = settledLength(this.#blocks);
  }

  /** The number of top-level blocks that later input cannot change. */
  public get settledCount(): number {
    return this.#settled;
  }

  public checkpoint(): BlockParserCheckpoint | undefined {
    if (this.#containers.length !== 0 || !this.#leaf.idle) {
      return undefined;
    }

    const tail = this.#blocks.at(-1);

    // A checkpoint keeps this list, so its items must not grow in place any more.
    if (tail?.kind === "list") {
      this.#items.owned.delete(tail.items);
    }

    return { length: this.#blocks.length, tail };
  }

  public fork(checkpoint: BlockParserCheckpoint): BlockParser {
    const blocks = this.#blocks.slice(0, checkpoint.length);

    if (checkpoint.tail !== undefined) {
      blocks[blocks.length - 1] = checkpoint.tail;
    }

    return new BlockParser(this.#syntax, blocks, this.#onSettled);
  }

  /**
   * A copy of the unsettled part: a trailing list, the open containers, and
   * the active leaf. Finishing it costs only the open tail.
   */
  public tail(): BlockParser {
    const copy = new BlockParser(this.#syntax, this.#blocks.slice(this.#settled));
    copy.#items.draft = true;
    copy.#containers.push(...this.#containers);
    copy.#leaf.copyFrom(this.#leaf);

    return copy;
  }

  public pending(): PendingBlockSyntax | undefined {
    return this.#leaf.pending();
  }

  public write(source: SourceText, physicalLine: PhysicalLine): void {
    this.#leaf.rollback();
    this.writeLine(source, physicalLine);

    while (this.#onSettled !== undefined && this.#settled < settledLength(this.#blocks)) {
      this.#onSettled(this.#blocks[this.#settled], this.#settled);
      this.#settled++;
    }
  }

  private writeLine(source: SourceText, physicalLine: PhysicalLine): void {
    let cursor =
      physicalLine.range.start === 0 && source.char(0) === "\uFEFF"
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
    let line = contentLine(physicalLine, cursor);
    const unmatchedFrame = this.#containers[matchedContainers];

    const siblingItem =
      unmatchedFrame?.kind === "listItem" && isSiblingListItem(source, line, unmatchedFrame);

    const lazy = unmatched && !siblingItem && this.#leaf.canLazyContinue(source, line);

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

      if (this.#leaf.hasParagraph) {
        if (opensContainer(source, line, this.#syntax)) {
          this.appendLeafBlocks(this.#leaf.finish());
          cursor = openContainers(source, physicalLine, cursor, this.#containers, this.#syntax);
        }
      } else {
        cursor = openContainers(source, physicalLine, cursor, this.#containers, this.#syntax);
      }
    }

    line = contentLine(physicalLine, cursor);
    const task = taskListMarker(source, line, this.#containers, this.#leaf.hasParagraph);

    if (task !== undefined) {
      this.#containers[this.#containers.length - 1] = {
        ...task.frame,
        checked: task.checked,
      };
      line = contentLine(physicalLine, task.contentStart);
    }

    if (isBlankLine(source, line)) {
      markListBlank(this.#containers);
    } else {
      settleListBlank(this.#containers, lazy ? this.#containers.length : matchedContainers);
    }

    const allowFrontmatter =
      physicalLine.line === 1 && this.#blocks.length === 0 && this.#containers.length === 0;

    this.appendLeafBlocks(this.#leaf.write(source, line, allowFrontmatter));
  }

  public finish(source: SourceText): readonly BlockSyntax[] {
    this.#leaf.rollback();
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
        appendListItem(this.#blocks, this.#containers, frame, this.#items);
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

/** Arrays an open leaf grows in place. Only the parser that created one extends it. */
const growable = new WeakSet<readonly unknown[]>();

function isGrowable<T>(array: readonly T[]): array is T[] {
  return growable.has(array);
}

/**
 * Extensions a tail draft made to its parser's arrays, undone before the parser
 * reads them again. A draft lives for one update, so its lines never outlast it.
 */
type DraftLog = Array<readonly [unknown[], number]>;

class LeafParser {
  readonly #syntax: ResolvedSyntaxOptions;
  #active: OpenLeaf | undefined;
  /** Set on a tail draft: extensions are logged so the parser can undo them. */
  #draftLog: DraftLog | undefined;
  readonly #log: DraftLog = [];
  #expressionScanner: JavaScriptScanner | undefined;
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
    source.rollback();
    this.#draftLog = source.#log;
    this.#active = source.#active;
    this.#expressionScanner = source.#expressionScanner?.clone();
    this.#jsxScanner = source.#jsxScanner?.clone();
  }

  /** Undoes a tail draft's extensions, so the open leaf holds only written lines. */
  public rollback(): void {
    for (let index = this.#log.length - 1; index >= 0; index--) {
      const [array, length] = this.#log[index];
      array.length = length;
    }

    this.#log.length = 0;
  }

  /**
   * Appends to a leaf array without copying it. A tail draft logs the old
   * length, so the parser it came from can undo the extension.
   */
  private grow<T>(array: readonly T[], ...items: T[]): readonly T[] {
    if (!isGrowable(array)) {
      const copy = [...array, ...items];
      growable.add(copy);

      return copy;
    }

    this.#draftLog?.push([array, array.length]);
    array.push(...items);

    return array;
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
        meta: active.meta,
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

    if (active.kind === "jsx") {
      return {
        kind: "jsx",
        range: sourceRange(active.start, active.end),
        opening: this.#jsxScanner?.opening(),
      };
    }

    if (active.kind === "expression" || active.kind === "esm") {
      return {
        kind: active.kind,
        range: sourceRange(active.start, active.end),
      };
    }

    return;
  }

  public canLazyContinue(source: SourceText, line: PhysicalLine): boolean {
    return (
      this.#active?.kind === "paragraph" &&
      !isBlankLine(source, line) &&
      !this.interruptsParagraph(source, line) &&
      !opensContainer(source, line, this.#syntax)
    );
  }

  public write(
    source: SourceText,
    line: PhysicalLine,
    allowFrontmatter = false,
  ): readonly BlockSyntax[] {
    const blocks: BlockSyntax[] = [];

    if (this.continueActive(source, line, blocks)) {
      return blocks;
    }

    if (isBlankLine(source, line)) {
      return [...blocks, ...this.finish()];
    }

    if (this.continueParagraph(source, line, blocks)) {
      return blocks;
    }

    this.startLeaf(source, line, allowFrontmatter, blocks);

    return blocks;
  }

  /**
   * Feeds a line to an open leaf that owns its lines. Returns `false` when the
   * leaf closed without consuming the line, so the line starts new content.
   */
  private continueActive(source: SourceText, line: PhysicalLine, blocks: BlockSyntax[]): boolean {
    const active = this.#active;

    switch (active?.kind) {
      case "expression":
      case "jsx":
        this.continueEmbedded(source, line, active, blocks);

        return true;
      case "esm":
        if (isBlankLine(source, line)) {
          blocks.push(this.finishEmbedded(source));
        } else {
          this.#active = {
            ...active,
            end: line.range.end,
            value: this.grow(active.value, embeddedSegment(line)),
          };
        }

        return true;
      case "html":
        if (source.slice(line.content.start, line.content.end).includes(active.closing)) {
          blocks.push(this.closeActive(line.range.end));
        } else {
          this.#active = { ...active, end: line.range.end };
        }

        return true;
      case "frontmatter":
        if (source.slice(line.content.start, line.content.end).trim() === active.fence) {
          blocks.push(this.closeActive(line.range.end));
        } else {
          this.#active = { ...active, end: line.range.end, valueEnd: line.range.end };
        }

        return true;
      case "math":
        if (isClosingMathFence(source, line, active)) {
          blocks.push(this.closeActive(line.range.end));
        } else {
          this.#active = {
            ...active,
            end: line.range.end,
            value: this.grow(active.value, { kind: "source", range: line.range }),
          };
        }

        return true;
      case "fencedCode":
        if (isClosingFence(source, line, active)) {
          blocks.push(this.closeActive(line.range.end));
        } else {
          this.#active = {
            ...active,
            end: line.range.end,
            value: this.grow(active.value, { kind: "source", range: line.range }),
          };
        }

        return true;
      case "indentedCode":
        return this.continueIndentedCode(source, line, active, blocks);
      case "table":
        return this.continueTable(source, line, active, blocks);
      case "paragraph":
      case undefined:
        return false;
      default: {
        const exhaustive: never = active;

        return exhaustive;
      }
    }
  }

  private continueEmbedded(
    source: SourceText,
    line: PhysicalLine,
    active: OpenJsx | OpenExpression,
    blocks: BlockSyntax[],
  ): void {
    const scanner = active.kind === "expression" ? this.#expressionScanner : this.#jsxScanner;

    if (scanner === undefined) {
      throw new Error(`Missing retained scanner for ${active.kind}`);
    }

    const result = scanner.append(source.slice(line.range.start, line.range.end));
    this.#active = {
      ...active,
      end: line.range.end,
      value: this.grow(active.value, embeddedSegment(line)),
    };

    if (result.kind !== "open") {
      blocks.push(this.finishEmbedded(source, result.kind === "invalid"));
    }
  }

  /** Blank lines stay pending until more indented code follows them. */
  private continueIndentedCode(
    source: SourceText,
    line: PhysicalLine,
    active: OpenIndentedCode,
    blocks: BlockSyntax[],
  ): boolean {
    if (isBlankLine(source, line)) {
      this.#active = {
        ...active,
        end: line.range.end,
        pendingBlank: this.grow(active.pendingBlank, {
          kind: "source",
          range: sourceRange(line.content.end, line.range.end),
        }),
      };

      return true;
    }

    const indented = indentedCodeLine(source, line);

    if (indented !== undefined) {
      this.#active = {
        ...active,
        end: line.range.end,
        value: this.grow(active.value, ...active.pendingBlank, ...indented),
        pendingBlank: [],
      };

      return true;
    }

    blocks.push(this.closeActive());

    return false;
  }

  private continueTable(
    source: SourceText,
    line: PhysicalLine,
    active: OpenTable,
    blocks: BlockSyntax[],
  ): boolean {
    if (isBlankLine(source, line)) {
      blocks.push(this.closeActive());

      return false;
    }

    this.#active = {
      ...active,
      end: line.range.end,
      rows: this.grow(active.rows, tableRow(source, line.content)),
    };

    return true;
  }

  /**
   * A paragraph line can turn the paragraph into a setext heading or a table,
   * or continue it. Returns `false` when the line interrupts the paragraph.
   */
  private continueParagraph(
    source: SourceText,
    line: PhysicalLine,
    blocks: BlockSyntax[],
  ): boolean {
    const active = this.#active;

    if (active?.kind !== "paragraph") {
      return false;
    }

    const setext = recognizeSetext(source, line, active);

    if (setext.kind === "matched") {
      blocks.push(setext.value);
      this.#active = undefined;

      return true;
    }

    const table = recognizeTable(source, line, active);

    if (table.kind === "matched") {
      this.#active = table.value;

      return true;
    }

    if (this.interruptsParagraph(source, line)) {
      blocks.push(this.closeActive());

      return false;
    }

    this.#active = {
      kind: "paragraph",
      start: active.start,
      end: line.content.end,
      lines: this.grow(
        active.lines,
        { kind: "source", range: active.pendingEnding },
        { kind: "source", range: line.content },
      ),
      pendingEnding: sourceRange(line.content.end, line.range.end),
    };

    return true;
  }

  /** Starts the leaf a non-blank line opens, in CommonMark precedence order. */
  private startLeaf(
    source: SourceText,
    line: PhysicalLine,
    allowFrontmatter: boolean,
    blocks: BlockSyntax[],
  ): void {
    if (!startsParagraph(source, line.content.start)) {
      if (allowFrontmatter) {
        const frontmatter = recognizeFrontmatter(source, line, this.#syntax);

        if (frontmatter.kind === "matched") {
          this.#active = frontmatter.value;

          return;
        }
      }

      for (const recognize of [recognizeLeafDirective, recognizeSameLineMath]) {
        const result = recognize(source, line, this.#syntax);

        if (result.kind === "matched") {
          blocks.push(result.value);

          return;
        }
      }

      const math = recognizeMathFence(source, line, this.#syntax);

      if (math.kind === "matched") {
        this.#active = math.value;

        return;
      }

      if (this.startEmbedded(source, line, blocks)) {
        return;
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

          return;
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

        return;
      }
    }

    this.#active = {
      kind: "paragraph",
      start: line.content.start,
      end: line.content.end,
      lines: [{ kind: "source", range: line.content }],
      pendingEnding: sourceRange(line.content.end, line.range.end),
    };
  }

  /**
   * Starts flow JSX, an expression, or ESM. Returns `false` when the construct
   * closes with more content on its line, which makes it phrasing content.
   */
  private startEmbedded(source: SourceText, line: PhysicalLine, blocks: BlockSyntax[]): boolean {
    const embedded = recognizeEmbeddedFlowStart(source, line);

    if (embedded.kind !== "matched") {
      return false;
    }

    this.#active = {
      kind: embedded.value.kind,
      start: line.content.start,
      end: line.range.end,
      value: [embeddedSegment(line)],
    };

    if (embedded.value.kind === "esm") {
      return true;
    }

    const start =
      embedded.value.kind === "expression" ? embedded.value.markerEnd : line.content.start;

    const text = source.slice(start, line.range.end);
    let result;

    if (embedded.value.kind === "expression") {
      this.#expressionScanner = new JavaScriptScanner("}");
      result = this.#expressionScanner.append(text);
    } else {
      this.#jsxScanner = new JsxBoundaryScanner();
      result = this.#jsxScanner.append(text);
    }

    // Like MDX, a construct followed by more content on its line is phrasing content.
    const phrasing =
      result.kind === "closed" && !isBlank(source.slice(start + result.offset, line.content.end));

    if (!phrasing) {
      if (result.kind !== "open") {
        blocks.push(this.finishEmbedded(source, result.kind === "invalid"));
      }

      return true;
    }

    this.#active = undefined;
    this.#expressionScanner = undefined;
    this.#jsxScanner = undefined;

    return false;
  }

  public finish(source?: SourceText): readonly BlockSyntax[] {
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
      const opening = this.#jsxScanner?.opening();
      this.#active = undefined;
      this.#expressionScanner = undefined;
      this.#jsxScanner = undefined;

      return [
        {
          kind: "invalidMdx",
          range: sourceRange(active.start, active.end),
          syntax: active.kind,
          state: "incomplete",
          opening,
        },
      ];
    }

    return this.#active === undefined ? [] : [this.closeActive()];
  }

  private finishEmbedded(source: SourceText, structurallyInvalid = false): BlockSyntax {
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
          // The construct is structurally closed, so later input cannot repair it.
          state: "invalid",
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

  private interruptsParagraph(source: SourceText, line: PhysicalLine): boolean {
    if (startsParagraph(source, line.content.start)) {
      return false;
    }

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

/** Unindented letters start paragraphs, except the ESM keywords import and export. */
function startsParagraph(source: SourceText, start: number): boolean {
  const character = source.char(start);

  return isAsciiLetter(character) && character !== "i" && character !== "e";
}

/** Rejects ordinary content before slicing a potentially long, chunked line. */
function isBlankLine(source: SourceText, line: PhysicalLine): boolean {
  return (
    line.content.start === line.content.end ||
    (isSpaceOrTab(source.char(line.content.start)) &&
      isBlank(source.slice(line.content.start, line.content.end)))
  );
}

function matchEmbeddedFlowStart(
  source: SourceText,
  line: PhysicalLine,
): EmbeddedFlowStart | undefined {
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
  source: SourceText,
  line: PhysicalLine,
): RecognizerResult<EmbeddedFlowStart> {
  const match = matchEmbeddedFlowStart(source, line);

  return match === undefined ? noMatch : matched(match);
}

function segmentsText(source: SourceText, segments: readonly InlineSegment[]): string {
  let value = "";

  for (const segment of segments) {
    value +=
      segment.kind === "source"
        ? source.slice(segment.range.start, segment.range.end)
        : " ".repeat(segment.columns);
  }

  return value;
}

/**
 * Top-level blocks that later input cannot change. A closing list item merges
 * into a preceding list with the same marker, so only a trailing list can grow.
 */
function settledLength(blocks: readonly BlockSyntax[]): number {
  return blocks.at(-1)?.kind === "list" ? blocks.length - 1 : blocks.length;
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

/**
 * How a parser grows top-level lists. The parser pushes into item arrays it
 * owns, since only it extends them; a tail draft records its closed items
 * separately and never touches the parser's arrays.
 */
interface ListItemGrowth {
  draft: boolean;
  readonly owned: WeakMap<readonly ListItemSyntax[], ListItemSyntax[]>;
}

function appendListItem(
  root: BlockSyntax[],
  containers: ContainerFrame[],
  frame: Extract<ContainerFrame, { kind: "listItem" }>,
  growth: ListItemGrowth,
): void {
  const item: ListItemSyntax = {
    range: sourceRange(frame.rangeStart, frame.end),
    checked: frame.checked,
    spread: frame.spread,
    children: frame.children,
  };

  const parent = containers.at(-1);
  // Top-level siblings change in place, so a growing list costs only its last entry.
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
      spread: previous.spread || previous.trailingBlank || frame.spread,
      ...grownItems(previous, item, parent === undefined ? growth : undefined),
      trailingBlank: frame.blankPending,
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
      trailingBlank: frame.blankPending,
    });
  }

  if (parent !== undefined) {
    containers[containers.length - 1] = {
      ...parent,
      children: siblings,
    };
  }
}

/** The items after appending `item`, without copying the items a top-level list already has. */
function grownItems(
  list: ListSyntax,
  item: ListItemSyntax,
  growth: ListItemGrowth | undefined,
): Pick<ListSyntax, "items" | "closing"> {
  if (growth === undefined) {
    return { items: [...list.items, ...(list.closing ?? []), item] };
  }

  if (growth.draft) {
    return { items: list.items, closing: [...(list.closing ?? []), item] };
  }

  const owned = growth.owned.get(list.items);

  if (owned !== undefined) {
    owned.push(item);

    return { items: owned };
  }

  const items = [...list.items, item];
  growth.owned.set(items, items);

  return { items };
}

function continueContainer(
  source: SourceText,
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
  source: SourceText,
  line: PhysicalLine,
  initialCursor: number,
  containers: ContainerFrame[],
  syntax: ResolvedSyntaxOptions,
): number {
  let cursor = initialCursor;

  while (cursor < line.content.end) {
    if (isAsciiLetter(source.char(cursor))) {
      break;
    }

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
      blankPending: false,
      rangeStart: list.markerStart,
      end: line.range.end,
      children: [],
    });
    cursor = list.contentStart;
  }

  return cursor;
}

function opensContainer(
  source: SourceText,
  line: PhysicalLine,
  syntax: ResolvedSyntaxOptions,
): boolean {
  if (isAsciiLetter(source.char(line.content.start))) {
    return false;
  }

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
  source: SourceText,
  start: number,
  end: number,
  required: number,
): number | undefined {
  const indent = consumeIndent(source, start, end, required);

  return indent.columns >= required ? indent.offset : undefined;
}

function indentedCodeLine(
  source: SourceText,
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

/** Records a blank line in the trailing list items that directly contain it. */
function markListBlank(containers: ContainerFrame[]): void {
  for (let index = containers.length - 1; index >= 0; index--) {
    const frame = containers[index];

    if (frame.kind !== "listItem") {
      return;
    }

    containers[index] = { ...frame, blankPending: true };
  }
}

/**
 * Resolves pending blank lines once content arrives. Only the deepest surviving
 * item receives a new direct child after the blank line, which makes it loose. A
 * new sibling item of a nested list keeps the blank inside that nested list.
 */
function settleListBlank(containers: ContainerFrame[], surviving: number): void {
  const opened = containers[surviving];

  for (let index = 0; index < surviving; index++) {
    const frame = containers[index];

    if (frame.kind !== "listItem" || !frame.blankPending) {
      continue;
    }

    const last = frame.children.at(-1);

    const nestedSibling =
      opened?.kind === "listItem" &&
      last?.kind === "list" &&
      last.ordered === opened.ordered &&
      last.marker === opened.markerCharacter;

    containers[index] = {
      ...frame,
      blankPending: false,
      spread: frame.spread || (index === surviving - 1 && !nestedSibling),
    };
  }
}

function contentLine(line: PhysicalLine, contentStart: number): PhysicalLine {
  if (line.range.start === contentStart) {
    return line;
  }

  return {
    line: line.line,
    range: sourceRange(contentStart, line.range.end),
    content: sourceRange(contentStart, line.content.end),
    ending: line.ending,
  };
}

/**
 * Parses a nested flow region, such as multi-line JSX children, with offsets in
 * the enclosing source. Frontmatter is never recognized inside the region.
 */
export function parseFlowRange(
  source: SourceText,
  range: SourceRange,
  syntax: ResolvedSyntaxOptions,
): readonly BlockSyntax[] {
  const scanner = new PhysicalLineScanner({ offset: range.start });
  const parser = new BlockParser({ ...syntax, frontmatter: [] });

  for (const physicalLine of [
    ...scanner.append(source.slice(range.start, range.end)),
    ...scanner.complete(),
  ]) {
    parser.write(source, physicalLine);
  }

  return parser.finish(source);
}

/** An embedded flow line from its content to the end of the line, including the ending. */
function embeddedSegment(line: PhysicalLine): InlineSegment {
  return { kind: "source", range: sourceRange(line.content.start, line.range.end) };
}
