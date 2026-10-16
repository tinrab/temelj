/**
 * Immutable text in a few flat chunks, read by absolute offset. Appending makes
 * a new text that shares the chunks before it, so a growing document is never
 * copied whole. Chunks merge like a binary counter, so a text has O(log n)
 * chunks and each character is copied O(log n) times in total.
 */
export class SourceText {
  readonly #chunks: readonly string[];
  readonly #starts: readonly number[];
  public readonly length: number;
  /** The text has no NUL, so the parser reads it as it is. */
  public readonly plain: boolean;
  #joined: string | undefined;
  readonly #single: string | undefined;
  /** The chunk of the last read, since reads cluster around one offset. */
  #hint = 0;

  private constructor(
    chunks: readonly string[],
    starts: readonly number[],
    length: number,
    plain: boolean,
  ) {
    this.#chunks = chunks;
    this.#starts = starts;
    this.#single = chunks.length === 1 ? chunks[0] : undefined;
    this.length = length;
    this.plain = plain;
  }

  public static of(this: void, text: string): SourceText {
    return text.length === 0
      ? new SourceText([], [], 0, true)
      : new SourceText([text], [0], text.length, !text.includes("\0"));
  }

  /** The text the parser reads: NUL becomes U+FFFD. */
  public grammar(): SourceText {
    return this.plain ? this : SourceText.of(this.toString().replaceAll("\0", "\uFFFD"));
  }

  /** The same text in one chunk, for complete-document reads. */
  public flatten(): SourceText {
    return this.#chunks.length <= 1
      ? this
      : new SourceText([this.toString()], [0], this.length, this.plain);
  }

  public append(text: string): SourceText {
    if (text.length === 0) {
      return this;
    }

    const chunks = [...this.#chunks, text];
    const starts = [...this.#starts, this.length];

    // Like a binary counter, a chunk merges into the one before it once it is as large.
    while (
      chunks.length > 1 &&
      chunks[chunks.length - 2].length <= chunks[chunks.length - 1].length
    ) {
      const last = chunks[chunks.length - 1];
      chunks.length--;
      starts.length--;
      chunks[chunks.length - 1] = flat(chunks[chunks.length - 1] + last);
    }

    return new SourceText(
      chunks,
      starts,
      this.length + text.length,
      this.plain && !text.includes("\0"),
    );
  }

  /** The character at `offset`, or `undefined` outside the text. */
  public char(offset: number): string | undefined {
    // A complete document is one chunk, so batch parsing reads it like a string.
    if (this.#single !== undefined) {
      return this.#single[offset];
    }

    if (offset < 0 || offset >= this.length) {
      return undefined;
    }

    const index = this.chunkAt(offset);

    return this.#chunks[index][offset - this.#starts[index]];
  }

  public slice(start: number, end: number = this.length): string {
    if (this.#single !== undefined) {
      return this.#single.slice(start, end);
    }

    const from = Math.max(0, Math.min(start, this.length));
    const to = Math.max(from, Math.min(end, this.length));

    if (from === to) {
      return "";
    }

    let index = this.chunkAt(from);
    let result = "";

    // Concatenation builds a rope, so a slice costs its chunk count until it is read.
    while (index < this.#chunks.length && this.#starts[index] < to) {
      const chunk = this.#chunks[index];
      const chunkStart = this.#starts[index];
      result += chunk.slice(
        Math.max(0, from - chunkStart),
        Math.min(chunk.length, to - chunkStart),
      );
      index++;
    }

    return result;
  }

  /** The first `search` at or after `from`, scanning chunk by chunk. */
  public indexOf(search: string, from = 0): number {
    const begin = Math.max(0, from);

    if (begin >= this.length) {
      return search.length === 0 ? this.length : -1;
    }

    for (let index = this.chunkAt(begin); index < this.#chunks.length; index++) {
      const start = Math.max(begin, this.#starts[index]);
      // Reach into the next chunk, so a match across the boundary is found.
      const end = this.#starts[index] + this.#chunks[index].length + search.length - 1;
      const found = this.slice(start, end).indexOf(search);

      if (found !== -1) {
        return start + found;
      }
    }

    return -1;
  }

  /** Finds one matching code unit without joining the chunks. The pattern must be global. */
  public findCharacter(pattern: RegExp, from: number): number {
    for (let index = this.chunkAt(from); index < this.#chunks.length; index++) {
      const start = this.#starts[index];
      // RegExp clamps a negative cursor to zero for later chunks.
      pattern.lastIndex = from - start;

      if (pattern.test(this.#chunks[index])) {
        return start + pattern.lastIndex - 1;
      }
    }

    return this.length;
  }

  /** The last `search`, scanning chunks from the end. Matches may span chunks. */
  public lastIndexOf(search: string): number {
    for (let index = this.#chunks.length - 1; index >= 0; index--) {
      const start = this.#starts[index];
      // Include the end of the previous chunk, so a match across the boundary is found.
      const from = Math.max(0, start - search.length + 1);
      const found = this.slice(from, start + this.#chunks[index].length).lastIndexOf(search);

      if (found !== -1) {
        return from + found;
      }
    }

    return -1;
  }

  public startsWith(search: string, position = 0): boolean {
    return this.slice(position, position + search.length) === search;
  }

  /** The whole text. A text in several chunks joins them once. */
  public toString(): string {
    if (this.#joined === undefined) {
      this.#joined = this.#chunks.length === 1 ? this.#chunks[0] : flat(this.#chunks.join(""));
    }

    return this.#joined;
  }

  private chunkAt(offset: number): number {
    const starts = this.#starts;
    const hint = this.#hint;

    if (starts[hint] <= offset && (starts[hint + 1] ?? Infinity) > offset) {
      return hint;
    }

    let low = 0;
    let high = starts.length - 1;

    while (low < high) {
      const middle = (low + high + 1) >> 1;

      if (starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    this.#hint = low;

    return low;
  }
}

/** Reading one character makes the engine store a concatenated string flat. */
function flat(value: string): string {
  void value.charCodeAt(0);

  return value;
}
