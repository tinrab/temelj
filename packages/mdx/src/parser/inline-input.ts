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

export interface InlineCharacter {
  readonly character: string;
  readonly sourceOffset: number;
  readonly virtual: boolean;
}

/** Source-backed block content with explicit virtual indentation. */
export class InlineInput {
  readonly #characters: readonly InlineCharacter[];
  public readonly file: SourceFile;
  public readonly segments: readonly InlineSegment[];

  public constructor(file: SourceFile, segments: readonly InlineSegment[]) {
    this.file = file;
    this.segments = segments.map(validateSegment);
    this.#characters = materializeCharacters(file, this.segments);
  }

  public get length(): number {
    return this.#characters.length;
  }

  public at(index: number): InlineCharacter | undefined {
    return this.#characters[index];
  }

  public sourceRange(start = 0, end = this.length): SourceRange {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      throw new RangeError(`Invalid inline range ${start}..${end}`);
    }
    if (end > this.length) {
      throw new RangeError(`Inline range ${start}..${end} exceeds input length ${this.length}`);
    }
    const first = this.#characters[start];
    const last = this.#characters[end - 1];
    if (first === undefined) {
      const offset = this.#characters.at(-1)?.sourceOffset ?? 0;
      return sourceRange(offset, offset);
    }
    return sourceRange(first.sourceOffset, (last?.sourceOffset ?? first.sourceOffset) + 1);
  }

  public toString(): string {
    return this.#characters.map((entry) => entry.character).join("");
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

function materializeCharacters(
  file: SourceFile,
  segments: readonly InlineSegment[],
): InlineCharacter[] {
  const characters: InlineCharacter[] = [];
  for (const segment of segments) {
    if (segment.kind === "virtualSpace") {
      for (let column = 0; column < segment.columns; column++) {
        characters.push({ character: " ", sourceOffset: segment.offset, virtual: true });
      }
      continue;
    }
    file.slice(segment.range);
    for (let offset = segment.range.start; offset < segment.range.end; offset++) {
      characters.push({
        character: file.character(offset) ?? "",
        sourceOffset: offset,
        virtual: false,
      });
    }
  }
  return characters;
}
