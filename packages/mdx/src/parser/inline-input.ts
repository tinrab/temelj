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
 * Offsets and segments that successive inputs of one growing text share. Each
 * input reads its own prefix; only the newest input may extend the storage, and
 * it only ever writes past every existing input's end.
 */
class InputStorage {
  offsets = new Uint32Array(64);
  /** The segments as given, compared by identity when a later input extends this one. */
  readonly inputs: InlineSegment[] = [];
  /** Text length after each segment. */
  readonly ends: number[] = [];
  tip: InlineInput | undefined;

  public reserve(length: number): void {
    if (length > this.offsets.length) {
      const grown = new Uint32Array(Math.max(length, this.offsets.length * 2));
      grown.set(this.offsets);
      this.offsets = grown;
    }
  }
}

/**
 * Source-backed block content with explicit virtual indentation. Text is built
 * once; each character keeps the source offset it came from.
 */
export class InlineInput {
  readonly #storage: InputStorage;
  readonly #text: SourceText;
  public readonly file: SourceFile;

  /**
   * `base` is an earlier input of the same growing text, such as the open
   * paragraph before an append. When this input only adds text after it, the
   * base's decoded text and offsets are shared and only the new text is decoded.
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
      let length = text.length;

      if (grown?.kind === "source" && previous?.kind === "source" && grown !== previous) {
        const start = previous.range.end;
        const part = file.semanticSlice({ start, end: grown.range.end });
        storage.reserve(length + part.length);

        for (let offset = start; offset < grown.range.end; offset++) {
          storage.offsets[length++] = offset;
        }

        text = text.append(part);
        storage.inputs[last] = grown;
        storage.ends[last] = length;
      }

      this.#text = this.append(segments, last + 1, length, text);
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

    const offsets = this.#storage.offsets;

    if (start === this.length) {
      const offset = this.length === 0 ? 0 : offsets[this.length - 1];

      return sourceRange(offset, offset);
    }

    const first = offsets[start];

    return sourceRange(first, (end === 0 ? first : offsets[end - 1]) + 1);
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

      storage.reserve(index + part.length);

      if (segment.kind === "virtualSpace") {
        storage.offsets.fill(segment.offset, index, index + segment.columns);
        index += segment.columns;
      } else {
        for (let offset = segment.range.start; offset < segment.range.end; offset++) {
          storage.offsets[index++] = offset;
        }
      }

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
