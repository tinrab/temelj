import type { Primitive, PrimitiveObject, PrimitiveValue } from "./types";

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isBigInt(value: unknown): value is bigint {
  return typeof value === "bigint";
}

export function isSymbol(value: unknown): value is symbol {
  return typeof value === "symbol";
}

export function isFunction(value: unknown): value is Function {
  return typeof value === "function";
}

export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

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

export function isPlainObject(value: unknown): value is object {
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

function isPrimitiveContainer(
  value: unknown,
  active: Set<object>,
): value is PrimitiveObject | PrimitiveValue[] {
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
