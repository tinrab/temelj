import type { SourceRange } from "../ranges.ts";
import type { SourceFile } from "../source.ts";

import { sourceRange } from "../ranges.ts";
import { SourceText } from "../source-text.ts";

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
 * Segments that successive inputs of one growing text share. Each
 * input reads its own prefix; only the newest input may extend the storage, and
 * it only ever writes past every existing input's end.
 */
class InputStorage {
  /** The segments as given, compared by identity when a later input extends this one. */
  readonly inputs: InlineSegment[] = [];
  /** Text length after each segment. */
  readonly ends: number[] = [];
  tip: InlineInput | undefined;
}

/**
 * Source-backed block content with explicit virtual indentation. Text is built
 * once; segment boundaries map characters back to their source offsets.
 */
export class InlineInput {
  readonly #storage: InputStorage;
  readonly #text: SourceText;
  public readonly file: SourceFile;

  /**
   * `base` is an earlier input of the same growing text, such as the open
   * paragraph before an append. When this input only adds text after it, the
   * base's decoded text and segment boundaries are shared; only new text is decoded.
   */
  public constructor(file: SourceFile, segments: readonly InlineSegment[], base?: InlineInput) {
    this.file = file;
    const storage = base === undefined ? undefined : base.extendable(file, segments);

    if (base === undefined || storage === undefined) {
      this.#storage = new InputStorage();
      this.#text = this.append(segments, 0, 0, SourceText.of(""));
    } else {
      this.#storage = storage;
      // The base's last segment may have grown on the same line, so it is decoded past its old end.
      const last = segments.length === 0 ? -1 : storage.inputs.length - 1;
      const grown = segments[last];
      const previous = storage.inputs[last];
      let text = base.#text;

      if (grown?.kind === "source" && previous?.kind === "source" && grown !== previous) {
        const start = previous.range.end;
        const part = file.semanticSlice({ start, end: grown.range.end });
        text = text.append(part);
        storage.inputs[last] = grown;
        storage.ends[last] = text.length;
      }

      this.#text = this.append(segments, last + 1, text.length, text);
    }

    this.#storage.tip = this;
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
      const offset = this.length === 0 ? 0 : this.sourceOffset(this.length - 1);

      return sourceRange(offset, offset);
    }

    const first = this.sourceOffset(start);

    return sourceRange(first, (end === 0 ? first : this.sourceOffset(end - 1)) + 1);
  }

  /** Source segments are contiguous; virtual indentation maps to one authored tab. */
  private sourceOffset(offset: number): number {
    const { inputs, ends } = this.#storage;
    let low = 0;
    let high = inputs.length - 1;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (offset < ends[middle]) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }

    const segment = inputs[low];

    return segment.kind === "virtualSpace"
      ? segment.offset
      : segment.range.start + offset - (low === 0 ? 0 : ends[low - 1]);
  }

  public toString(): string {
    return this.#text.toString();
  }

  /** The text in chunks, which an extended input shares instead of copying. */
  public text(): SourceText {
    return this.#text;
  }

  /** Whether this input was built by extending `other`, so it starts with the same text. */
  public extends(other: InlineInput): boolean {
    return this.#storage === other.#storage && this.length >= other.length;
  }

  /**
   * The shared storage, when `segments` extend this input's: every segment is
   * the same object except the last, which may only have grown at its end.
   */
  private extendable(
    file: SourceFile,
    segments: readonly InlineSegment[],
  ): InputStorage | undefined {
    const storage = this.#storage;
    const count = storage.inputs.length;

    if (storage.tip !== this || !this.file.isPrefixOf(file) || segments.length < count) {
      return undefined;
    }

    // The file only grew, so complete lines keep their segments; the open line can be rebuilt.
    for (let index = Math.max(0, count - 3); index < count - 1; index++) {
      if (!sameSegment(storage.inputs[index], segments[index])) {
        return undefined;
      }
    }

    const previous = storage.inputs[count - 1];
    const next = segments[count - 1];

    const grows =
      previous === next ||
      (previous?.kind === "source" &&
        next?.kind === "source" &&
        next.range.start === previous.range.start &&
        next.range.end >= previous.range.end);

    return grows && count > 0 ? storage : undefined;
  }

  /** Decodes segments from `from` into the storage after `length` characters of `text`. */
  private append(
    segments: readonly InlineSegment[],
    from: number,
    length: number,
    text: SourceText,
  ): SourceText {
    const storage = this.#storage;
    const parts: string[] = [];
    let index = length;

    for (let position = from; position < segments.length; position++) {
      const segment = validateSegment(segments[position]);

      const part =
        segment.kind === "source"
          ? this.file.semanticSlice(segment.range)
          : " ".repeat(segment.columns);

      index += part.length;
      parts.push(part);
      storage.inputs[position] = segments[position];
      storage.ends[position] = index;
    }

    // A fresh input joins its parts once; an extension appends the few new ones.
    return text.length === 0
      ? SourceText.of(parts.join(""))
      : parts.reduce((result, part) => result.append(part), text);
  }
}

function sameSegment(left: InlineSegment | undefined, right: InlineSegment | undefined): boolean {
  if (left === right) {
    return true;
  }

  if (left?.kind === "source" && right?.kind === "source") {
    return left.range.start === right.range.start && left.range.end === right.range.end;
  }

  return (
    left?.kind === "virtualSpace" &&
    right?.kind === "virtualSpace" &&
    left.offset === right.offset &&
    left.columns === right.columns
  );
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
