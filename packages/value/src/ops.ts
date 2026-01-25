import fastEquals from "react-fast-compare";

import { isPrimitiveValue } from "./check";
import type { PrimitiveValue } from "./types";

/**
 * Compares two values for deep equality.
 *
 * @param a The first value to compare.
 * @param b The second value to compare.
 * @returns `true` if the values are deeply equal, `false` otherwise.
 */
export function deepEquals(a: unknown, b: unknown): boolean {
  return fastEquals(a, b);
}

/**
 * Converts a value to a primitive value.
 * Maps and sets are converted to arrays and objects, respectively.
 * Objects are converted to plain records.
 *
 * @param value The value to convert.
 * @returns The primitive value.
 */
export function primitivize(value: unknown): PrimitiveValue {
  if (value instanceof Map) {
    // Assumes all keys are strings.
    const entries: Record<string, PrimitiveValue> = {};
    for (const [k, v] of value.entries()) {
      entries[String(k)] = primitivize(v);
    }
    return entries;
  }
  if (value instanceof Set) {
    const items: PrimitiveValue[] = [];
    for (const v of value) {
      items.push(primitivize(v));
    }
    return items;
  }
  if (Array.isArray(value)) {
    return value.map((x) => primitivize(x));
  }
  if (value?.constructor === Object) {
    const newObj: Record<string, PrimitiveValue> = {};
    for (const [k, v] of Object.entries(value)) {
      newObj[k] = primitivize(v);
    }
    return newObj;
  }
  if (!isPrimitiveValue(value)) {
    throw new Error(`Cannot convert value to primitive: ${value}`);
  }
  return value;
}
