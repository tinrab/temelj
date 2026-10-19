import { isString } from "@temelj/value";

import type { SourceRange } from "./ranges.ts";

import { InputError } from "./errors.ts";
import { sourceRange } from "./ranges.ts";
import { SourceText } from "./source-text.ts";

export interface SourceFileInput {
  readonly name?: string;
  readonly text: string;
}

export interface SourceLocation {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** A range in a specific source file. Diagnostics carry spans because they outlive trees. */
export interface SourceSpan {
  readonly file: SourceFile;
  readonly start: number;
  readonly end: number;
}

export interface PhysicalLine {
  readonly line: number;
  readonly range: SourceRange;
  readonly content: SourceRange;
  readonly ending: "" | "\n" | "\r" | "\r\n";
}

/** The semantic character represented by NUL in parsed source. */
export const REPLACEMENT_CHARACTER = "\uFFFD";

export function semanticCharacter(value: string): string {
  return value === "\0" ? REPLACEMENT_CHARACTER : value;
}

/** The column after a tab, with four-column tab stops. */
export function nextTabColumn(column: number): number {
  return column + (4 - ((column - 1) % 4));
}

/**
 * Physical lines of a text that only grows. The files of one buffer generation
 * share one index, which scans each character once instead of once per file.
 */
class LineIndex {
  readonly lines: PhysicalLine[] = [];
  readonly #scanner = new PhysicalLineScanner();
  #length = 0;

  /** Scans `text`, which extends every text scanned before, from where the last scan ended. */
  public extend(text: SourceText): void {
    if (text.length > this.#length) {
      this.lines.push(...this.#scanner.append(text.slice(this.#length)));
      this.#length = text.length;
    }
  }
}

/** A file's lines: the index's complete lines it contains, then its own last lines. */
interface LineTable {
  readonly complete: readonly PhysicalLine[];
  readonly count: number;
  readonly tail: readonly PhysicalLine[];
}

let createFile: (name: string, text: SourceText, index: LineIndex) => SourceFile;

let readText: (file: SourceFile) => SourceText;

/**
 * Immutable authored source with UTF-16 offsets and exact physical line
 * boundaries. Files from a `SourceBuffer` share text chunks and a line index,
 * so reading a growing document never copies it whole.
 */
export class SourceFile {
  #source: SourceText;
  #index: LineIndex | undefined;
  #table: LineTable | undefined;
  public readonly name: string;

  static {
    createFile = (name, text, index) => {
      const file = new SourceFile({ name, text: "" });
      file.#source = text;
      file.#index = index;

      return file;
    };

    readText = (file) => file.#source;
  }

  public constructor(input: string | SourceFileInput) {
    this.#source = SourceText.of(isString(input) ? input : input.text);
    this.name = isString(input) ? "source.mdx" : (input.name ?? "source.mdx");
    Object.freeze(this);
  }

  /** The whole text. Prefer `slice` and `length`, which do not join a growing text. */
  public get text(): string {
    return this.#source.toString();
  }

  public get length(): number {
    return this.#source.length;
  }

  /**
   * Whether `other` is known to start with this file's text: both come from
   * the same `SourceBuffer` with only appends between them.
   */
  public isPrefixOf(other: SourceFile): boolean {
    return (
      this === other ||
      (this.#index !== undefined && this.#index === other.#index && this.length <= other.length)
    );
  }

  public location(offset: number): SourceLocation {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.length) {
      throw InputError.sourceOffsetOutsideFile(offset, this.length);
    }

    let low = 0;
    let high = this.lineCount;

    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);

      if (this.physicalLine(middle).range.start <= offset) {
        low = middle;
      } else {
        high = middle;
      }
    }

    let column = 1;

    for (let index = this.physicalLine(low).range.start; index < offset; index++) {
      column = this.#source.char(index) === "\t" ? nextTabColumn(column) : column + 1;
    }

    return Object.freeze({ offset, line: low + 1, column });
  }

  public lineStart(line: number): number | undefined {
    return this.line(line)?.range.start;
  }

  public get lineCount(): number {
    const table = this.table();

    return table.count + table.tail.length;
  }

  public line(line: number): PhysicalLine | undefined {
    return line >= 1 && line <= this.lineCount ? this.physicalLine(line - 1) : undefined;
  }

  public lineAt(offset: number): PhysicalLine {
    return this.physicalLine(this.location(offset).line - 1);
  }

  public character(offset: number): string | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.length) {
      throw InputError.sourceOffsetOutsideFile(offset, this.length);
    }

    const value = this.#source.char(offset);

    return value === undefined ? undefined : semanticCharacter(value);
  }

  public slice(range: SourceRange): string {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > this.length
    ) {
      throw InputError.replacementRangeOutsideSource(range.start, range.end, this.length);
    }

    return this.#source.slice(range.start, range.end);
  }

  public semanticSlice(range: SourceRange): string {
    return this.slice(range).replaceAll("\0", "\uFFFD");
  }

  private physicalLine(index: number): PhysicalLine {
    const table = this.table();

    return index < table.count ? table.complete[index] : table.tail[index - table.count];
  }

  private table(): LineTable {
    if (this.#table !== undefined) {
      return this.#table;
    }

    const index = this.#index;

    if (index === undefined) {
      const lines = Object.freeze(indexLines(this.text));
      this.#table = { complete: lines, count: lines.length, tail: [] };

      return this.#table;
    }

    index.extend(this.#source);
    const { lines } = index;
    let count = lines.length;

    // An earlier file in the chain holds a prefix of the indexed text.
    while (count > 0 && lines[count - 1].range.end > this.length) {
      count--;
    }

    const last = lines[count - 1];

    const scanner = new PhysicalLineScanner({
      offset: last?.range.end ?? 0,
      line: (last?.line ?? 0) + 1,
    });

    const tail = Object.freeze([
      ...scanner.append(this.#source.slice(last?.range.end ?? 0)),
      ...scanner.complete(),
    ]);

    this.#table = { complete: lines, count, tail };

    return this.#table;
  }
}

/**
 * Source that a stream owns and changes. Appends keep one line index, so
 * successive files do not rescan their lines; an edit starts a new generation.
 * Each change returns an immutable `SourceFile` for that version.
 */
export class SourceBuffer {
  readonly #name: string;
  #index = new LineIndex();
  #text: SourceText;
  #file: SourceFile;

  public constructor(input: SourceFileInput) {
    this.#name = input.name ?? "source.mdx";
    this.#text = SourceText.of(input.text);
    this.#file = createFile(this.#name, this.#text, this.#index);
  }

  public get file(): SourceFile {
    return this.#file;
  }

  public append(text: string): SourceFile {
    this.#text = this.#text.append(text);
    this.#file = createFile(this.#name, this.#text, this.#index);

    return this.#file;
  }

  /** Replaces `start..end` with `text`. Earlier files keep their own lines. */
  public replace(start: number, end: number, text: string): SourceFile {
    const previous = this.#text;
    this.#text = SourceText.of(previous.slice(0, start) + text + previous.slice(end));
    this.#index = new LineIndex();
    this.#file = createFile(this.#name, this.#text, this.#index);

    return this.#file;
  }
}

/** The chunked text behind a file, for readers that index it by offset. */
export function sourceText(file: SourceFile): SourceText {
  return readText(file);
}

function indexLines(source: string): PhysicalLine[] {
  const scanner = new PhysicalLineScanner();

  return [...scanner.append(source), ...scanner.complete()];
}

function physicalLine(
  line: number,
  start: number,
  contentEnd: number,
  end: number,
  ending: PhysicalLine["ending"],
): PhysicalLine {
  return Object.freeze({
    line,
    range: sourceRange(start, end),
    content: sourceRange(start, contentEnd),
    ending,
  });
}

/** Incremental physical-line scanner. Each appended code unit is visited once. */
export class PhysicalLineScanner {
  #complete = false;
  #length: number;
  #line: number;
  #lineStart: number;
  #pendingCarriageReturn: number | undefined;

  public constructor(options: Readonly<{ offset?: number; line?: number }> = {}) {
    const offset = options.offset ?? 0;
    const line = options.line ?? 1;

    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(line) || line < 1) {
      throw new RangeError("Invalid physical-line scanner origin");
    }

    this.#length = offset;
    this.#lineStart = offset;
    this.#line = line;
  }

  public append(text: string): readonly PhysicalLine[] {
    if (this.#complete) {
      throw new Error("Cannot append to a completed physical-line scanner");
    }

    const lines: PhysicalLine[] = [];

    const endings = /\r\n|[\r\n]/gu;

    if (text.length > 0 && this.#pendingCarriageReturn !== undefined) {
      const offset = this.#pendingCarriageReturn;

      if (text[0] === "\n") {
        lines.push(this.emit(offset, this.#length + 1, "\r\n"));
        endings.lastIndex = 1;
      } else {
        lines.push(this.emit(offset, offset + 1, "\r"));
      }

      this.#pendingCarriageReturn = undefined;
    }

    for (let match = endings.exec(text); match !== null; match = endings.exec(text)) {
      const offset = this.#length + match.index;
      const ending = match[0];

      if (ending === "\r" && match.index === text.length - 1) {
        this.#pendingCarriageReturn = offset;
      } else {
        lines.push(
          this.emit(
            offset,
            offset + ending.length,
            ending === "\r\n" ? "\r\n" : ending === "\r" ? "\r" : "\n",
          ),
        );
      }
    }

    this.#length += text.length;

    return Object.freeze(lines);
  }

  public clone(): PhysicalLineScanner {
    const copy = new PhysicalLineScanner({ offset: this.#length, line: this.#line });
    copy.#complete = this.#complete;
    copy.#lineStart = this.#lineStart;
    copy.#pendingCarriageReturn = this.#pendingCarriageReturn;

    return copy;
  }

  public complete(): readonly PhysicalLine[] {
    if (this.#complete) {
      throw new Error("Physical-line scanner is already complete");
    }

    this.#complete = true;
    const lines: PhysicalLine[] = [];

    if (this.#pendingCarriageReturn !== undefined) {
      lines.push(this.emit(this.#pendingCarriageReturn, this.#pendingCarriageReturn + 1, "\r"));
      this.#pendingCarriageReturn = undefined;
    }

    lines.push(physicalLine(this.#line, this.#lineStart, this.#length, this.#length, ""));

    return Object.freeze(lines);
  }

  private emit(
    contentEnd: number,
    end: number,
    ending: Exclude<PhysicalLine["ending"], "">,
  ): PhysicalLine {
    const line = physicalLine(this.#line++, this.#lineStart, contentEnd, end, ending);
    this.#lineStart = end;

    return line;
  }
}
