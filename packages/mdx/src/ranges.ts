export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export function sourceRange(start: number, end: number): SourceRange {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new RangeError(`Invalid source range ${start}..${end}`);
  }
  return Object.freeze({ start, end });
}

export function rangeLength(range: SourceRange): number {
  return range.end - range.start;
}

export function rangeContains(range: SourceRange, offset: number): boolean {
  return range.start <= offset && offset < range.end;
}

export function rangesIntersect(left: SourceRange, right: SourceRange): boolean {
  if (right.start === right.end) {
    return left.start < right.start && right.start < left.end;
  }
  return left.start < right.end && right.start < left.end;
}

export function shiftRange(range: SourceRange, offset: number): SourceRange {
  return { start: range.start + offset, end: range.end + offset };
}
