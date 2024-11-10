import merge from "deepmerge";

import { combineMerge } from "~/array/ops.ts";

export function recordDeepMerge(...values: object[]): object {
  return merge.all(values, {
    clone: true,
    arrayMerge: combineMerge,
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
