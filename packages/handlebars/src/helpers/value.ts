import { ss } from "@temelj/standard-schema";
import {
  deepEquals,
  isPlainObject,
  isString,
  isNumber,
  isBoolean,
  isBigInt,
  isSymbol,
  isFunction,
  isObject,
  type PrimitiveValue,
  type Primitive,
  type JsonValue,
} from "@temelj/value";

import { createHelper } from "../helper_builder";
import { type HelperDeclareSpec, SafeString } from "../types";

type JsValue =
  | Primitive
  | Function
  | Date
  | RegExp
  | readonly JsValue[]
  | ReadonlyMap<JsValue, JsValue>
  | ReadonlySet<JsValue>
  | JsObject
  | JsonConvertible;

interface JsObject {
  readonly [key: string]: JsValue;
}

interface JsonConvertible {
  readonly toJSON: () => JsValue;
}

export function getValueHelpers(): HelperDeclareSpec {
  return {
    eq: (a: PrimitiveValue, b: PrimitiveValue) => deepEquals(a, b),
    ne: (a: PrimitiveValue, b: PrimitiveValue) => !deepEquals(a, b),
    lt: (a: number, b: number) => a < b,
    gt: (a: number, b: number) => a > b,
    lte: (a: number, b: number) => a <= b,
    gte: (a: number, b: number) => a >= b,
    and: (...args: unknown[]) => Array.prototype.every.call(args, Boolean),
    or: (...args: unknown[]) => Array.prototype.slice.call(args, 0, -1).some(Boolean),
    not: (x: number | boolean) => !x,

    orElse: <TValue, TDefault>(value: TValue, defaultValue: TDefault) => value || defaultValue,

    json: createHelper()
      .params(ss.unknown(), ss.defaulted(ss.boolean(), false))
      .handle(([value, pretty]) => {
        return pretty ? JSON.stringify(value, undefined, 2) : JSON.stringify(value);
      }),

    isEmpty: (obj: PrimitiveValue) => {
      return Array.isArray(obj)
        ? obj.length === 0
        : isPlainObject(obj)
          ? Object.keys(obj).length === 0
          : Boolean(obj) === false;
    },

    jsValue: (value: JsValue): SafeString => {
      return new SafeString(renderJsValue(value));
    },
  };
}

function renderJsValue(value: JsValue): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (isString(value)) {
    return JSON.stringify(value);
  }

  if (isNumber(value)) {
    if (Number.isNaN(value)) return "NaN";

    if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";

    return String(value);
  }

  if (isBigInt(value)) {
    return String(value) + "n";
  }

  if (isBoolean(value)) {
    return String(value);
  }

  if (isSymbol(value)) {
    return "Symbol(" + (value.description ? JSON.stringify(value.description) : "") + ")";
  }

  if (isFunction(value)) {
    return Function.prototype.toString.call(value);
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
    const elements = Array.from(value.values())
      .map((item) => renderJsValue(item))
      .join(", ");

    return `new Set([${elements}])`;
  }

  if (value instanceof Date) {
    return `new Date(${JSON.stringify(value.toISOString())})`;
  }

  if (value instanceof RegExp) {
    return String(value);
  }

  if (
    isObject(value) &&
    value !== null &&
    (value.constructor === Object || Object.getPrototypeOf(value) === null)
  ) {
    const properties = Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${renderJsValue(v)}`)
      .join(", ");

    return `{${properties}}`;
  }

  if (isObject(value) && value !== null) {
    if ("toJSON" in value && isFunction(value.toJSON)) {
      try {
        return renderJsValue(value.toJSON());
      } catch (cause) {
        return `/* Error in toJSON for ${String(value)}: ${String(cause instanceof Error ? cause.message : cause)} */`;
      }
    }

    try {
      const jsonStr = JSON.stringify(value);

      if (jsonStr !== undefined) {
        const parsed: JsonValue = JSON.parse(jsonStr);

        return renderJsValue(parsed);
      }
    } catch (cause) {
      return `/* Unserializable object: ${String(value)} (stringify error: ${cause instanceof Error ? cause.message : String(cause)}) */`;
    }

    return `/* Unhandled object type: ${String(value)} */`;
  }

  return String(value);
}
