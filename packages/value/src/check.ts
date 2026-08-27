import type { Primitive, PrimitiveObject, PrimitiveValue } from "./types";

/**
 * Checks if a value is a primitive value.
 *
 * @param value The value to check.
 * @returns `true` if the value is a primitive value, `false` otherwise.
 */
export function isPrimitive(value: unknown): value is Primitive {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    value === null ||
    value === undefined
  );
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

export function isPrimitiveObject(value: unknown): value is PrimitiveObject {
  return isPlainObject(value) && isPrimitiveContainer(value, new Set());
}

export function isPrimitiveValue(value: unknown): value is PrimitiveValue {
  return isPrimitive(value) || isPrimitiveContainer(value, new Set());
}

function isPrimitiveContainer(value: unknown, active: Set<object>): boolean {
  if (Array.isArray(value)) {
    if (active.has(value)) {
      return false;
    }
    active.add(value);
    for (const item of value) {
      if (!isPrimitive(item) && !isPrimitiveContainer(item, active)) {
        active.delete(value);
        return false;
      }
    }
    active.delete(value);
    return true;
  }
  if (!isPlainObject(value) || active.has(value)) {
    return false;
  }
  active.add(value);
  for (const item of Object.values(value)) {
    if (!isPrimitive(item) && !isPrimitiveContainer(item, active)) {
      active.delete(value);
      return false;
    }
  }
  active.delete(value);
  return true;
}
