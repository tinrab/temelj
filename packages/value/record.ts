import deepmerge from "deepmerge";
import { deepEquals } from "./ops.ts";

/**
 * Compares two records for equality, optionally using a custom comparison function.
 *
 * @param a The first record to compare.
 * @param b The second record to compare.
 * @param compare An optional custom comparison function to use for each value. If not provided, {@link deepEquals} will be used.
 */
export function recordEquals<V>(
  a: Record<string, V>,
  b: Record<string, V>,
  compare?: (a: V, b: V) => boolean,
): boolean {
  const aEntries = Object.entries(a);
  if (aEntries.length !== Object.keys(b).length) {
    return false;
  }
  if (compare === undefined) {
    for (const [aKey, aValue] of aEntries) {
      const bValue = b[aKey];
      if (bValue === undefined) {
        return false;
      }
      if (!deepEquals(aValue, bValue)) {
        return false;
      }
    }
  } else {
    for (const [aKey, aValue] of aEntries) {
      const bValue = b[aKey];
      if (bValue === undefined) {
        return false;
      }
      if (!compare(aValue, bValue)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Checks if a record is empty.
 *
 * @param value The record to check.
 * @returns `true` if the record is empty, `false` otherwise.
 */
export function recordIsEmpty<V>(value: Record<string, V>): boolean {
  return Object.keys(value).length === 0;
}

/**
 * Options for {@link recordMerge}.
 */
export interface RecordMergeOptions {
  clone?: boolean;
  arrayMerge?: <T, S>(
    target: T[],
    source: S[],
  ) => (T & S)[];
  isMergable?: (value: unknown) => boolean;
}

/**
 * Merges multiple records into a single record.
 *
 * @param records The records to merge.
 * @param options The options to use for merging the records.
 * @returns The merged record.
 */
export function recordMerge<T>(
  values: Partial<T>[],
  options: RecordMergeOptions = { clone: true },
): T {
  return deepmerge.all(values, {
    clone: options.clone,
    arrayMerge: options.arrayMerge,
    isMergeableObject: options.isMergable,
  } as deepmerge.Options) as T;
}
