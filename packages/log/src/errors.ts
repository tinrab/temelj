import type { FormattedLogRecord } from "./types.ts";

export interface SerializedLogError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: unknown;
}

export function serializeLogError(error: unknown): SerializedLogError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      ...(error.cause === undefined ? {} : { cause: toJsonSafeValue(error.cause) }),
    };
  }
  return {
    name: typeof error,
    message: String(error),
  };
}

export function errorFields(error: unknown): FormattedLogRecord {
  const serialized = serializeLogError(error);
  return {
    "error.name": serialized.name,
    "error.message": serialized.message,
    ...(serialized.stack === undefined ? {} : { "error.stack": serialized.stack }),
    ...(serialized.cause === undefined ? {} : { "error.cause": serialized.cause }),
  };
}

// TODO: Move to another package?
export function toJsonSafeValue(value: unknown): unknown {
  return toJsonSafeValueDeep(value, new WeakSet<object>());
}

function toJsonSafeValueDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (value instanceof Temporal.Instant) {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return serializeLogError(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return value.map((item) => toJsonSafeValueDeep(item, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, toJsonSafeValueDeep(item, seen)] as const)
        .filter(
          (entry): entry is readonly [string, NonNullable<unknown>] => entry[1] !== undefined,
        ),
    );
  }
  return String(value);
}
