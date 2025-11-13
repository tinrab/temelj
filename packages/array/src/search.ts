import { err, ok, type Result } from "@temelj/result";
import { deepEquals } from "@temelj/value";

/**
 * Performs a binary search on the given sorted array.
 *
 * @param arr The array to search.
 * @param value The value to search for.
 * @param compare A function that compares two elements of the array. If not provided, {@link deepEquals} will be used.
 * @returns A {@link Result} with the found index or an error with the index where the value should be inserted.
 *
 * @example Basic usage.
 *
 * ```ts
 * import { binarySearch } from "@temelj/array";
 * import { unwrap } from "@temelj/result";
 * import { expect, test } from "vitest";
 *
 * assertEquals(
 *  unwrap(binarySearch([1, 2, 3], 2, (a, b) => a - b)),
 *  1,
 * );
 * ```
 */
export function binarySearch<T>(
  arr: T[],
  value: T,
  compare: (a: T, b: T) => number,
): Result<number, number> {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const cmp = compare(arr[mid], value);
    if (cmp === 0) {
      return ok(mid);
    }
    if (cmp < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return err(lo);
}

/**
 * Checks if the given array contains any duplicates.
 *
 * @param arr The array to check.
 * @param compare An optional custom comparison function to use for each element. If not provided, {@link deepEquals} will be used.
 * @returns `true` if the array contains any duplicates, `false` otherwise.
 */
export function containsDuplicates<T>(
  arr: T[],
  compare?: (a: T, b: T) => boolean,
): boolean {
  if (compare === undefined) {
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (deepEquals(a, b)) {
          return true;
        }
      }
    }
  } else {
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (compare(a, b)) {
          return true;
        }
      }
    }
  }
  return false;
}
