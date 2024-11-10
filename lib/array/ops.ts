import merge from "deepmerge";
import { isObjectPrimitive } from "~/value/check.ts";

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
    return a.every((item, index) => compare(item, b[index]));
  }

  return a.every((item, index) => Object.is(item, b[index]));
}

export function combineMerge(
  target: Partial<unknown>[],
  source: Partial<unknown>[],
): unknown[] {
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
}

// deno-lint-ignore no-explicit-any
export function collectMap<K extends keyof any, V, V1 = V>(
  elements: V[],
  getKey: (element: V) => K,
  map: (element: V) => V1 = (v) => v as unknown as V1,
): Record<K, V1> {
  const result = {} as Record<K, V1>;
  for (const element of elements) {
    result[getKey(element)] = map(element);
  }
  return result;
}
