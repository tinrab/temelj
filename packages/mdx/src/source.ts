import type { SourceRange } from "./ranges.ts";

import { InputError } from "./errors.ts";
import { sourceRange } from "./ranges.ts";
import { nextTabColumn, semanticCharacter } from "./utility.ts";

export interface SourceFileInput {
  readonly name?: string;
  readonly text: string;
}

export interface SourceLocation {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface PhysicalLine {
  readonly line: number;
  readonly range: SourceRange;
  readonly content: SourceRange;
  readonly ending: "" | "\n" | "\r" | "\r\n";
}

/** Immutable authored source with UTF-16 offsets and exact physical line boundaries. */
export class SourceFile {
  #lines: readonly PhysicalLine[] | undefined;
  public readonly name: string;
  public readonly text: string;

  public constructor(input: string | SourceFileInput) {
    this.text = typeof input === "string" ? input : input.text;
    this.name = typeof input === "string" ? "source.mdx" : (input.name ?? "source.mdx");
    Object.freeze(this);
  }

  public location(offset: number): SourceLocation {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.text.length) {
      InputError.sourceOffsetOutsideFile(offset, this.text.length);
    }

    const lines = this.lines();
    let low = 0;
    let high = lines.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lines[middle].range.start <= offset) {
        low = middle;
      } else {
        high = middle;
      }
    }

    let column = 1;
    for (let index = lines[low].range.start; index < offset; index++) {
      column = this.text[index] === "\t" ? nextTabColumn(column) : column + 1;
    }
    return Object.freeze({ offset, line: low + 1, column });
  }

  public lineStart(line: number): number | undefined {
    return this.lines()[line - 1]?.range.start;
  }

  public get lineCount(): number {
    return this.lines().length;
  }

  public line(line: number): PhysicalLine | undefined {
    return this.lines()[line - 1];
  }

  public lineAt(offset: number): PhysicalLine {
    return this.lines()[this.location(offset).line - 1];
  }

  public character(offset: number): string | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.text.length) {
      InputError.sourceOffsetOutsideFile(offset, this.text.length);
    }
    const value = this.text[offset];
    return value === undefined ? undefined : semanticCharacter(value);
  }

  public slice(range: SourceRange): string {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > this.text.length
    ) {
      InputError.replacementRangeOutsideSource(range.start, range.end, this.text.length);
    }
    return this.text.slice(range.start, range.end);
  }

  public semanticSlice(range: SourceRange): string {
    return this.slice(range).replaceAll("\0", "\uFFFD");
  }

  private lines(): readonly PhysicalLine[] {
    this.#lines ??= Object.freeze(indexLines(this.text));
    return this.#lines;
  }
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
    for (let index = 0; index < text.length; index++) {
      const offset = this.#length + index;
      const character = text[index];
      if (this.#pendingCarriageReturn !== undefined) {
        if (character === "\n") {
          lines.push(this.emit(this.#pendingCarriageReturn, offset + 1, "\r\n"));
          this.#pendingCarriageReturn = undefined;
          continue;
        }
        lines.push(this.emit(this.#pendingCarriageReturn, this.#pendingCarriageReturn + 1, "\r"));
        this.#pendingCarriageReturn = undefined;
      }
      if (character === "\r") {
        this.#pendingCarriageReturn = offset;
      } else if (character === "\n") {
        lines.push(this.emit(offset, offset + 1, "\n"));
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
