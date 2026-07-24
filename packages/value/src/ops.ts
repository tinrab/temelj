import type { PrimitiveValue } from "./types";

import { isPrimitiveValue } from "./check";
import { ValueConversionError } from "./errors";

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
    ValueConversionError.notPrimitive(value);
  }
  return value;
}
