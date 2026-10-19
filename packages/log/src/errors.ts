import {
  isBigInt,
  isBoolean,
  isNumber,
  isPrimitive,
  isString,
  isSymbol,
  type JsonObject,
  type JsonValue,
} from "@temelj/value";

import type { FormattedLogRecord, LogAttributeValue } from "./types.ts";

export interface SerializedLogError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: JsonValue;
}

export function serializeLogError(cause: unknown): SerializedLogError {
  return serializeError(cause, new WeakSet());
}

function serializeError(cause: unknown, seen: WeakSet<object>): SerializedLogError {
  if (!(cause instanceof Error)) {
    return { name: "ThrownValue", message: String(cause) };
  }

  if (seen.has(cause)) {
    return { name: cause.name, message: "[Circular]" };
  }

  seen.add(cause);

  const result: SerializedLogError = {
    name: cause.name,
    message: cause.message,
    stack: cause.stack,
    cause: cause.cause === undefined ? undefined : serializeCause(cause.cause, seen),
  };

  seen.delete(cause);

  return result;
}

function serializeCause(cause: unknown, seen: WeakSet<object>): JsonValue {
  if (isPrimitive(cause)) {
    return toJsonSafeValueDeep(cause, seen) ?? null;
  }

  return errorObject(serializeError(cause, seen));
}

function errorObject(error: SerializedLogError): JsonObject {
  const result: JsonObject = { name: error.name, message: error.message };

  if (error.stack !== undefined) result.stack = error.stack;

  if (error.cause !== undefined) result.cause = error.cause;

  return result;
}

export function errorFields(cause: unknown): FormattedLogRecord {
  const serialized = serializeLogError(cause);

  const result: FormattedLogRecord = {
    "error.name": serialized.name,
    "error.message": serialized.message,
  };

  if (serialized.stack !== undefined) result["error.stack"] = serialized.stack;

  if (serialized.cause !== undefined) result["error.cause"] = serialized.cause;

  return result;
}

export function toJsonSafeValue(value: LogAttributeValue): JsonValue | undefined {
  return toJsonSafeValueDeep(value, new WeakSet());
}

function toJsonSafeValueDeep(
  value: LogAttributeValue,
  seen: WeakSet<object>,
): JsonValue | undefined {
  if (value === null || isString(value) || isBoolean(value)) return value;

  if (isNumber(value)) return Number.isFinite(value) ? value : null;

  if (value === undefined) return undefined;

  if (isBigInt(value) || isSymbol(value)) return String(value);

  if (value instanceof Temporal.Instant) return value.toString();

  if (value instanceof Date) return value.toJSON();

  if (value instanceof Error) return errorObject(serializeError(value, seen));

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => toJsonSafeValueDeep(item, seen) ?? null);
    }

    const result: JsonObject = {};

    for (const [key, item] of Object.entries(value)) {
      const converted = toJsonSafeValueDeep(item, seen);

      if (converted !== undefined) {
        Object.defineProperty(result, key, {
          value: converted,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }

    return result;
  } finally {
    seen.delete(value);
  }
}
