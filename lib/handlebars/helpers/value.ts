import { deepEquals } from "../../value/ops.ts";
import type { PrimitiveValue } from "../../value/types.ts";
import type { HelperDeclareSpec } from "./types.ts";

export function getValueHelpers(): HelperDeclareSpec {
  return {
    "eq": (a: PrimitiveValue, b: PrimitiveValue) => deepEquals(a, b),
    "ne": (a: PrimitiveValue, b: PrimitiveValue) => !deepEquals(a, b),
    "lt": (a: number, b: number) => a < b,
    "gt": (a: number, b: number) => a > b,
    "lte": (a: number, b: number) => a <= b,
    "gte": (a: number, b: number) => a >= b,
    "and": (...args: unknown[]) => Array.prototype.every.call(args, Boolean),
    "or": (...args: unknown[]) =>
      Array.prototype.slice.call(args, 0, -1).some(Boolean),
    "not": (x: number | boolean) => !x,

    "orElse": (value: unknown, defaultValue: unknown) => value || defaultValue,

    "toJson": (value: unknown, pretty: boolean) =>
      pretty ? JSON.stringify(value, undefined, 2) : JSON.stringify(value),
  };
}
