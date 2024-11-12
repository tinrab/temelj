import type { Primitive, PrimitiveObject, PrimitiveValue } from "./types.ts";

/**
 * Checks if a value is a primitive value.
 *
 * @param value The value to check.
 * @returns `true` if the value is a primitive value, `false` otherwise.
 */
export function isValuePrimitive(
  value: unknown,
): value is Primitive {
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

/**
 * Checks if a value is a primitive value.
 *
 * @param value The value to check.
 * @returns `true` if the value is a primitive value, `false` otherwise.
 */
export function isObjectPrimitive(
  obj: unknown,
): obj is PrimitiveObject {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const proto = Object.getPrototypeOf(obj);
  if (proto === null) {
    return true;
  }

  let baseProto = proto;
  while (Object.getPrototypeOf(baseProto) !== null) {
    baseProto = Object.getPrototypeOf(baseProto);
  }
  return baseProto === proto;
}

/**
 * Checks if a value is a primitive value.
 *
 * @param value The value to check.
 * @returns `true` if the value is a primitive value, `false` otherwise.
 */
export function isObjectDeepPrimitive(obj: unknown): obj is PrimitiveObject {
  if (!isObjectPrimitive(obj)) {
    return false;
  }

  for (const [_, v] of Object.entries(obj)) {
    if (!isValuePrimitive(v) && !isObjectDeepPrimitive(v)) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if a value is a primitive value.
 *
 * @param value The value to check.
 * @returns `true` if the value is a primitive value, `false` otherwise.
 */
export function isPrimitiveValue(value: unknown): value is PrimitiveValue {
  return isValuePrimitive(value) || isObjectDeepPrimitive(value);
}
