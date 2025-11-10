import { deepEquals, isObjectPrimitive } from "@temelj/value";
import merge from "deepmerge";

/**
 * Compares two arrays for equality, optionally using a custom comparison function.
 *
 * @param a The first array to compare.
 * @param b The second array to compare.
 * @param compare An optional custom comparison function to use for each element. If not provided, {@link deepEquals} will be used.
 * @returns `true` if the arrays are equal, `false` otherwise.
 */
export function equals<T>(
  a: T[],
  b: T[],
  compare?: (a: T, b: T) => boolean,
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  if (a.length === 0) {
    if (b.length === 0) {
      return true;
    }
    return false;
  }
  if (b.length === 0) {
    return false;
  }

  if (compare !== undefined) {
    for (let i = 0; i < a.length; i++) {
      if (!compare(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  for (let i = 0; i < a.length; i++) {
    if (!deepEquals(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Combines and merges two arrays.
 * It merges object primitives at the same index.
 *
 * @param target The target array to combine into.
 * @param source The source array to combine from.
 * @returns A new array that is the combination of the target and source arrays.
 */
export function combineMerge<A, B>(target: A[], source: B[]): (A & B)[] {
  const result: unknown[] = [...target];
  let i = 0;
  for (const item of source) {
    if (result[i] === undefined) {
      result[i] = structuredClone(item);
    } else if (isObjectPrimitive(item)) {
      result[i] = merge(target[i] as Partial<A>, item) as Partial<unknown>;
    } else if (
      target.find((targetItem) => deepEquals(targetItem, item)) === undefined
    ) {
      result.push(item);
    }
    i++;
  }
  return result as (A & B)[];
}
