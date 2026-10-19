export interface FormatPoint {
  readonly line: number;
  readonly column: number;
}

export interface FormatTrackInfo {
  readonly now: FormatPoint;
  readonly lineShift: number;
}

export class FormatTracker {
  #line: number;
  #column: number;
  #lineShift: number;

  public constructor(info: FormatTrackInfo) {
    this.#line = info.now.line;
    this.#column = info.now.column;
    this.#lineShift = info.lineShift;
  }

  public current(): FormatTrackInfo {
    return { now: { line: this.#line, column: this.#column }, lineShift: this.#lineShift };
  }

  public move(value: string): string {
    const lines = value.split(/\r\n?|\n/gu);
    const tail = lines.at(-1) ?? "";
    this.#line += lines.length - 1;
    this.#column =
      lines.length === 1 ? this.#column + tail.length : 1 + tail.length + this.#lineShift;

    return value;
  }

  public shift(value: number): void {
    this.#lineShift += value;
  }
}
