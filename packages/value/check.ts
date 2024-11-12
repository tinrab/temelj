import type { PrimitiveObject, PrimitiveValue } from "./types.ts";

export function isValuePrimitive(
  value: unknown,
): value is PrimitiveValue {
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
