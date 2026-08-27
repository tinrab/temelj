export interface FormatPoint {
  readonly line: number;
  readonly column: number;
}

export interface FormatTrackInfo {
  readonly now: FormatPoint;
  readonly lineShift: number;
}

export interface FormatTracker {
  current(): FormatTrackInfo;
  move(value: string): string;
  shift(value: number): void;
}

export function createFormatTracker(info: FormatTrackInfo): FormatTracker {
  let line = info.now.line;
  let column = info.now.column;
  let lineShift = info.lineShift;
  return { current, move, shift };

  function current(): FormatTrackInfo {
    return { now: { line, column }, lineShift };
  }

  function move(value: string): string {
    const lines = value.split(/\r\n?|\n/gu);
    const tail = lines.at(-1) ?? "";
    line += lines.length - 1;
    column = lines.length === 1 ? column + tail.length : 1 + tail.length + lineShift;
    return value;
  }

  function shift(value: number): void {
    lineShift += value;
  }
}
