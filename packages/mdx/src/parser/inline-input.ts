import type { SourceRange } from "../ranges.ts";
import type { SourceFile } from "../source.ts";

import { sourceRange } from "../ranges.ts";

export interface SourceInlineSegment {
  readonly kind: "source";
  readonly range: SourceRange;
}

export interface VirtualSpaceInlineSegment {
  readonly kind: "virtualSpace";
  readonly offset: number;
  readonly columns: number;
}

export type InlineSegment = SourceInlineSegment | VirtualSpaceInlineSegment;

/**
 * Source-backed block content with explicit virtual indentation. Text is built
 * once; each character keeps the source offset it came from.
 */
export class InlineInput {
  readonly #offsets: Uint32Array;
  readonly #text: string;
  public readonly file: SourceFile;
  public readonly segments: readonly InlineSegment[];

  public constructor(file: SourceFile, segments: readonly InlineSegment[]) {
    this.file = file;
    this.segments = segments.map(validateSegment);
    const parts: string[] = [];
    let length = 0;

    for (const segment of this.segments) {
      const part =
        segment.kind === "source" ? file.semanticSlice(segment.range) : " ".repeat(segment.columns);

      parts.push(part);
      length += part.length;
    }

    this.#text = parts.join("");
    this.#offsets = new Uint32Array(length);
    let index = 0;

    for (const segment of this.segments) {
      if (segment.kind === "virtualSpace") {
        this.#offsets.fill(segment.offset, index, index + segment.columns);
        index += segment.columns;
        continue;
      }

      for (let offset = segment.range.start; offset < segment.range.end; offset++) {
        this.#offsets[index++] = offset;
      }
    }
  }

  public get length(): number {
    return this.#text.length;
  }

  public sourceRange(start = 0, end = this.length): SourceRange {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      throw new RangeError(`Invalid inline range ${start}..${end}`);
    }

    if (end > this.length) {
      throw new RangeError(`Inline range ${start}..${end} exceeds input length ${this.length}`);
    }

    if (start === this.length) {
      const offset = this.length === 0 ? 0 : this.#offsets[this.length - 1];

      return sourceRange(offset, offset);
    }

    const first = this.#offsets[start];

    return sourceRange(first, (end === 0 ? first : this.#offsets[end - 1]) + 1);
  }

  public toString(): string {
    return this.#text;
  }
}

function validateSegment(segment: InlineSegment): InlineSegment {
  if (segment.kind === "source") {
    return {
      kind: "source",
      range: sourceRange(segment.range.start, segment.range.end),
    };
  }

  if (
    !Number.isSafeInteger(segment.offset) ||
    !Number.isSafeInteger(segment.columns) ||
    segment.offset < 0 ||
    segment.columns < 1
  ) {
    throw new RangeError("Invalid virtual inline indentation");
  }

  return { ...segment };
}
