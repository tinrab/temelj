import { WorkflowTransformError } from "./error.ts";

interface SourceReplacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Small source rewriting helper for AST-position based transforms. */
export class SourceEditor {
  readonly #source: string;
  readonly #replacements: SourceReplacement[] = [];

  constructor(source: string) {
    this.#source = source;
  }

  remove(start: number, end: number): void {
    this.replace(start, end, "");
  }

  replace(start: number, end: number, text: string): void {
    if (start < 0 || end < start || end > this.#source.length) {
      WorkflowTransformError.invalidSourceReplacementRange(start, end);
    }
    this.#replacements.push({ start, end, text });
  }

  read(start: number, end: number): string {
    if (start < 0 || end < start || end > this.#source.length) {
      WorkflowTransformError.invalidSourceReadRange(start, end);
    }
    return this.#source.slice(start, end);
  }

  toString(): string {
    let result = this.#source;
    for (const replacement of this.#sortedReplacements()) {
      result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(
        replacement.end,
      )}`;
    }
    return result;
  }

  #sortedReplacements(): readonly SourceReplacement[] {
    const replacements = [...this.#replacements].sort((left, right) => {
      if (left.start !== right.start) {
        return right.start - left.start;
      }
      return right.end - left.end;
    });
    for (let index = 1; index < replacements.length; index++) {
      const previous = replacements[index - 1]!;
      const current = replacements[index]!;
      if (current.end > previous.start) {
        WorkflowTransformError.overlappingSourceReplacementRanges(
          current.start,
          current.end,
          previous.start,
          previous.end,
        );
      }
    }
    return replacements;
  }
}
