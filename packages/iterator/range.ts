/**
 * A numeric range.
 */
export type NumericRange = Array<NumericRangePart>;

/**
 * A numeric range part.
 */
export type NumericRangePart = number | NumericRangeBound;

/**
 * Represents a numeric range bound with start and end (inclusive) values.
 * The range can either be increasing or decreasing.
 */
export interface NumericRangeBound {
  from: number;
  to: number;
}

interface NumericRangeErrorOptions {
  invalidInteger?: string;
  invalidRange?: string;
}

/**
 * An error for working with numeric ranges.
 */
export class NumericRangeError extends Error
  implements NumericRangeErrorOptions {
  public readonly invalidInteger?: string;

  constructor(
    options: NumericRangeErrorOptions = {},
    errorOptions?: ErrorOptions,
  ) {
    let message: string | undefined;
    if (options.invalidInteger !== undefined) {
      message = `Invalid integer '${options.invalidInteger}'`;
    } else if (options.invalidRange !== undefined) {
      message = `Invalid range '${options.invalidRange}'`;
    }
    super(message ?? "Invalid numeric range", errorOptions);
    Object.assign(this, options);
  }
}

/**
 * Parses a string representation of a numeric range into a `NumericRange` array.
 *
 * The string should be a comma-separated list of numeric values or ranges. Ranges are
 * specified using the format `from..to` or `from..=to`, where `from` and `to` are
 * integers. If `from` is greater than `to`, the range is considered decreasing.
 *
 * If any part of the input string is not a valid integer or range,
 * a {@linkcode NumericRangeError} will be thrown.
 *
 * @param s The string to parse.
 * @returns A parsed numeric range.
 */
export function parseNumericRange(s: string): NumericRange {
  const range: NumericRange = [];

  for (
    const part of s
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  ) {
    const match = /^(-?\d+)\.\.(=?)(-?\d+)$/.exec(part);
    if (match) {
      const from = Number.parseInt(match[1]);
      if (!Number.isInteger(from)) {
        throw new NumericRangeError({ invalidRange: part });
      }
      const to = Number.parseInt(match[3]);
      if (!Number.isInteger(to)) {
        throw new NumericRangeError({ invalidRange: part });
      }

      if (from === to) {
        throw new NumericRangeError({ invalidRange: part });
      }

      range.push({
        from,
        to: match[2] === "=" ? to : from < to ? to - 1 : to + 1,
      });
      continue;
    }

    const value = Number.parseInt(part);
    if (!Number.isInteger(value) || value.toString() !== part) {
      throw new NumericRangeError({ invalidInteger: part });
    }
    range.push(value);
  }

  return range;
}

/**
 * Converts a numeric range to a string representation.
 *
 * @param range The range.
 * @returns The string representation of the numeric range.
 */
export function numericRangeToString(range: NumericRange): string {
  return range
    .map((part) => {
      if (typeof part === "number") {
        return part.toString();
      }
      const { from, to } = part;
      const inclusive = from < to ? to : to;
      const exclusive = from < to ? to + 1 : to - 1;
      return `${from}..${
        (from < to && to === inclusive) || (from > to && to === exclusive)
          ? "="
          : ""
      }${to}`;
    })
    .join(",");
}

/**
 * Checks whether the range is strictly increasing.
 *
 * @param range The range.
 * @returns `true` if the range is increasing, `false` otherwise.
 */
export function isNumericRangeIncreasing(range: NumericRange): boolean {
  for (const [i, part] of range.entries()) {
    if (i === 0) {
      if (typeof part !== "number") {
        if (part.from >= part.to) {
          return false;
        }
      }
      continue;
    }
    const prev = range[i - 1];
    if (typeof part === "number") {
      if (typeof prev === "number") {
        if (part <= prev) {
          return false;
        }
      } else {
        if (part <= prev.to) {
          return false;
        }
      }
    } else {
      if (part.from >= part.to) {
        return false;
      }
      if (typeof prev === "number") {
        if (part.from <= prev) {
          return false;
        }
      } else {
        if (prev.to >= part.from) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * Checks whether the range is strictly decreasing.
 *
 * @param range The range.
 * @returns `true` if the range is decreasing, `false` otherwise.
 */
export function isNumericRangeDecreasing(range: NumericRange): boolean {
  for (const [i, part] of range.entries()) {
    if (i === 0) {
      if (typeof part !== "number") {
        if (part.from <= part.to) {
          return false;
        }
      }
      continue;
    }
    const prev = range[i - 1];
    if (typeof part === "number") {
      if (typeof prev === "number") {
        if (part >= prev) {
          return false;
        }
      } else {
        if (part >= prev.to) {
          return false;
        }
      }
    } else {
      if (part.from <= part.to) {
        return false;
      }
      if (typeof prev === "number") {
        if (part.from >= prev) {
          return false;
        }
      } else {
        if (prev.to <= part.from) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * Flattens the range to a number array.
 *
 * @param range The range.
 * @returns Flattened number array.
 */
export function flattenNumericRange(range: NumericRange): number[] {
  const values: number[] = [];
  for (const part of range) {
    if (typeof part === "number") {
      values.push(part);
    } else if (part.from <= part.to) {
      for (let i = part.from; i <= part.to; i++) {
        values.push(i);
      }
    } else {
      for (let i = part.to; i <= part.from; i++) {
        values.push(i);
      }
    }
  }
  return values;
}

/**
 * Reverses the numeric range.
 *
 * @param range The range.
 * @returns A reversed range.
 */
export function reverseNumericRange(range: NumericRange): NumericRange {
  const reversed: NumericRange = [];
  for (let i = range.length - 1; i >= 0; i--) {
    const part = range[i];
    if (typeof part === "number") {
      reversed.push(part);
    } else {
      reversed.push({ from: part.to, to: part.from });
    }
  }
  return reversed;
}

/**
 * Checks if the given numeric range contains the specified value.
 *
 * @param range The numeric range to check.
 * @param value The value to check for in the range.
 * @returns `true` if the value is contained in the range, `false` otherwise.
 */
export function numericRangeContains(
  range: NumericRange,
  value: number,
): boolean {
  for (const part of range) {
    if (typeof part === "number") {
      if (part === value) {
        return true;
      }
    } else if (part.from <= part.to) {
      if (part.from <= value && value <= part.to) {
        return true;
      }
    } else {
      if (part.from >= value && value >= part.to) {
        return true;
      }
    }
  }
  return false;
}

/**
 * An iterator that iterates over a numeric range.
 */
export class NumericRangeIterator implements Iterator<number, number> {
  private readonly range: NumericRange;
  private partIndex: number;
  private rangeIndex: number;
  private count: number;

  public constructor(range: NumericRange) {
    this.range = range;
    this.partIndex = 0;
    this.rangeIndex = 0;
    this.count = 0;
  }

  next(): IteratorResult<number, number> {
    if (this.partIndex >= this.range.length) {
      return { value: this.count, done: true };
    }

    let value: number;
    const part = this.range[this.partIndex];

    if (typeof part === "number") {
      value = part;
      this.partIndex++;
      this.rangeIndex = 0;
    } else if (part.from <= part.to) {
      value = part.from + this.rangeIndex;
      this.rangeIndex++;
      if (value >= part.to) {
        this.partIndex++;
        this.rangeIndex = 0;
      }
    } else {
      value = part.from - this.rangeIndex;
      this.rangeIndex++;
      if (value <= part.to) {
        this.partIndex++;
        this.rangeIndex = 0;
      }
    }

    this.count++;

    return {
      value,
      done: false,
    };
  }

  [Symbol.iterator](): Iterator<number, number> {
    return this;
  }
}
