// deno-lint-ignore-file no-explicit-any

import {
  deepEquals,
  isObjectPrimitive,
  type PrimitiveValue,
} from "@temelj/value";
import { z } from "zod";

import { type HelperDeclareSpec, SafeString } from "../types.ts";
import { createHelperZod } from "../zod_helper_builder.ts";

export function getValueHelpers(): HelperDeclareSpec {
  return {
    eq: (a: PrimitiveValue, b: PrimitiveValue) => deepEquals(a, b),
    ne: (a: PrimitiveValue, b: PrimitiveValue) => !deepEquals(a, b),
    lt: (a: number, b: number) => a < b,
    gt: (a: number, b: number) => a > b,
    lte: (a: number, b: number) => a <= b,
    gte: (a: number, b: number) => a >= b,
    and: (...args: unknown[]) => Array.prototype.every.call(args, Boolean),
    or: (...args: unknown[]) =>
      Array.prototype.slice.call(args, 0, -1).some(Boolean),
    not: (x: number | boolean) => !x,

    orElse: (value: unknown, defaultValue: unknown) => value || defaultValue,

    json: createHelperZod()
      .params(z.any(), z.optional(z.boolean()).default(false))
      .handle(([value, pretty]) => {
        return pretty
          ? JSON.stringify(value, undefined, 2)
          : JSON.stringify(value);
      }),

    isEmpty: (obj: unknown) => {
      return Array.isArray(obj)
        ? obj.length === 0
        : isObjectPrimitive(obj)
        ? Object.keys(obj).length === 0
        : Boolean(obj) === false;
    },

    jsValue: (value: unknown): SafeString => {
      return new SafeString(renderJsValue(value));
    },
  };
}

function renderJsValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (Number.isNaN(value)) return "NaN";
      if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
      return String(value);
    case "bigint":
      return `${String(value)}n`;
    case "boolean":
      return String(value);
    case "symbol":
      return `Symbol(${
        value.description ? JSON.stringify(value.description) : ""
      })`;
      // case "function": return value.toString();
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => renderJsValue(item)).join(", ")}]`;
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .map(([k, v]) => `[${renderJsValue(k)}, ${renderJsValue(v)}]`)
      .join(", ");
    return `new Map([${entries}])`;
  }

  if (value instanceof Set) {
    const elements = Array.from(value.values()).map((item) =>
      renderJsValue(item)
    ).join(", ");
    return `new Set([${elements}])`;
  }

  if (value instanceof Date) {
    return `new Date(${JSON.stringify(value.toISOString())})`;
  }

  if (value instanceof RegExp) {
    return String(value);
  }

  if (
    typeof value === "object" && value !== null &&
    (value.constructor === Object || Object.getPrototypeOf(value) === null)
  ) {
    const properties = Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${renderJsValue(v)}`)
      .join(", ");
    return `{${properties}}`;
  }

  if (typeof value === "object" && value !== null) {
    if (typeof (value as { toJSON?: () => any }).toJSON === "function") {
      try {
        return renderJsValue((value as { toJSON: () => any }).toJSON());
      } catch (e: any) {
        return `/* Error in toJSON for ${
          Object.prototype.toString.call(value)
        }: ${e.message} */`;
      }
    }

    try {
      const jsonStr = JSON.stringify(value);
      if (jsonStr !== undefined) {
        if (jsonStr.startsWith("{") || jsonStr.startsWith("[")) {
          return renderJsValue(JSON.parse(jsonStr));
        }
        return renderJsValue(JSON.parse(jsonStr));
      }
    } catch (e: any) {
      return `/* Unserializable object: ${
        Object.prototype.toString.call(value)
      } (stringify error: ${e.message}) */`;
    }

    return `/* Unhandled object type: ${
      Object.prototype.toString.call(value)
    } */`;
  }

  return String(value);
}
