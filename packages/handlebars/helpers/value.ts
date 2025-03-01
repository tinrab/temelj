import * as v from "valibot";
import {
  deepEquals,
  isObjectPrimitive,
  type PrimitiveValue,
} from "@temelj/value";

import type { HelperDeclareSpec } from "./types.ts";
import { createHelperValibot } from "../valibot_helper_builder.ts";

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

    "toJson": createHelperValibot()
      .params(v.any(), v.optional(v.boolean(), false))
      .handle(([value, pretty]) => {
        return pretty
          ? JSON.stringify(value, undefined, 2)
          : JSON.stringify(value);
      }),

    "isEmpty": (obj: unknown) => {
      return Array.isArray(obj)
        ? obj.length === 0
        : isObjectPrimitive(obj)
        ? Object.keys(obj).length === 0
        : Boolean(obj) === false;
    },
  };
}
