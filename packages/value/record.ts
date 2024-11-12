import merge from "deepmerge";

import { isObjectPrimitive } from "./check.ts";

export function recordDeepMerge(...values: object[]): object {
  return merge.all(values, {
    clone: true,
    arrayMerge: (
      target: Partial<unknown>[],
      source: Partial<unknown>[],
    ) => {
      const result = [...target];
      for (const [index, item] of source.entries()) {
        if (result[index] === undefined) {
          result[index] = structuredClone(item);
        } else if (isObjectPrimitive(item)) {
          result[index] = merge(target[index], item) as Partial<unknown>;
        } else if (!target.includes(item)) {
          result.push(item);
        }
      }
      return result;
    },
  });
}

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
      if (!Object.is(aValue, bValue)) {
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

export function recordIsEmpty<V>(value: Record<string, V>): boolean {
  return Object.keys(value).length === 0;
}
