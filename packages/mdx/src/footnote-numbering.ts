/** A footnote reference's place in the document-wide footnote layout. */
export interface FootnoteOccurrence {
  /** The 1-based footnote number, assigned by first reference. */
  readonly ordinal: number;
  /** The 1-based count of references to the same footnote so far. */
  readonly occurrence: number;
}

/**
 * Numbers defined footnotes by first reference, in document order. Batch
 * lowering numbers one document; a stream numbers its settled prefix once and
 * forks the result for each open tail.
 */
export class FootnoteNumbering {
  readonly #order: string[] = [];
  readonly #ordinals = new Map<string, number>();
  readonly #counts = new Map<string, number>();

  /** Identifiers by first reference. */
  public get order(): readonly string[] {
    return this.#order;
  }

  /** Records the next reference to a defined footnote. */
  public reference(identifier: string): FootnoteOccurrence {
    let ordinal = this.#ordinals.get(identifier);

    if (ordinal === undefined) {
      this.#order.push(identifier);
      ordinal = this.#order.length;
      this.#ordinals.set(identifier, ordinal);
    }

    const occurrence = (this.#counts.get(identifier) ?? 0) + 1;
    this.#counts.set(identifier, occurrence);

    return { ordinal, occurrence };
  }

  public count(identifier: string): number {
    return this.#counts.get(identifier) ?? 0;
  }

  /** A copy that later references do not share. */
  public fork(): FootnoteNumbering {
    const copy = new FootnoteNumbering();
    copy.#order.push(...this.#order);

    for (const [identifier, ordinal] of this.#ordinals) {
      copy.#ordinals.set(identifier, ordinal);
    }

    for (const [identifier, count] of this.#counts) {
      copy.#counts.set(identifier, count);
    }

    return copy;
  }

  /** Two numberings produce the same footnote section when order and counts match. */
  public equals(other: FootnoteNumbering): boolean {
    return (
      this.#order.length === other.#order.length &&
      this.#order.every(
        (identifier, index) =>
          other.#order[index] === identifier && other.count(identifier) === this.count(identifier),
      )
    );
  }
}
