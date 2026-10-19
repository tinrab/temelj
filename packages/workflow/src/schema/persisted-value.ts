import { ss, type Schema } from "@temelj/standard-schema";
import { isTemporalStorageValue, type StorageValue } from "@temelj/storage";
import {
  isBigInt,
  isBoolean,
  isFunction,
  isNumber,
  isObject,
  isPlainObject,
  isString,
  isSymbol,
} from "@temelj/value";

import type { ValueIssue } from "../types/run.ts";

export const persistedValueSchema: Schema<unknown, StorageValue> = ss.schema((value) => {
  const issue = persistedValueIssue(value, "value", new WeakSet<object>(), false);

  // SAFETY: A value without a persistence issue is a valid StorageValue.
  return issue === undefined ? ss.success(value as StorageValue) : ss.failure(issue.message);
});

/** Returns the first persistence validation issue for a workflow value, if one exists. */
export function persistedValueIssue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Persistence validation inspects untrusted values before they enter workflow history.
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  allowUndefined: boolean,
): ValueIssue | undefined {
  if (value === undefined) {
    return allowUndefined ? undefined : unsupportedUndefinedIssue(path);
  }

  if (value === null || isBoolean(value) || isString(value)) {
    return undefined;
  }

  if (isNumber(value)) {
    return Number.isFinite(value) ? undefined : { path, message: "number must be finite" };
  }

  if (isBigInt(value)) {
    return undefined;
  }

  if (isFunction(value)) return { path, message: "function values are not supported" };

  if (isSymbol(value)) return { path, message: "symbol values are not supported" };

  if (!isObject(value)) return { path, message: "value type is not supported" };

  if (seen.has(value)) {
    return { path, message: "circular references are not supported" };
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? undefined : { path, message: "Date must be valid" };
  }

  if (isTemporalStorageValue(value) || value instanceof RegExp || value instanceof Uint8Array) {
    return undefined;
  }

  seen.add(value);

  try {
    if (value instanceof Map) {
      return persistedMapIssue(value, path, seen);
    }

    if (value instanceof Set) {
      return persistedSetIssue(value, path, seen);
    }

    if (Array.isArray(value)) {
      return persistedArrayIssue(value, path, seen);
    }

    if (isPlainObject(value)) {
      if (
        Object.getOwnPropertySymbols(value).some((key) =>
          Object.prototype.propertyIsEnumerable.call(value, key),
        )
      ) {
        return { path, message: "symbol keys are not supported" };
      }

      for (const [key, item] of Object.entries(value)) {
        const issue = persistedValueIssue(item, `${path}.${key}`, seen, false);

        if (issue !== undefined) return issue;
      }

      return undefined;
    }

    return { path, message: "object type is not supported" };
  } finally {
    seen.delete(value);
  }
}

function persistedArrayIssue(
  value: readonly unknown[],
  path: string,
  seen: WeakSet<object>,
): ValueIssue | undefined {
  for (const [index, item] of value.entries()) {
    const issue = persistedValueIssue(item, `${path}[${index}]`, seen, false);

    if (issue !== undefined) {
      return issue;
    }
  }

  return undefined;
}

function persistedMapIssue(
  value: ReadonlyMap<unknown, unknown>,
  path: string,
  seen: WeakSet<object>,
): ValueIssue | undefined {
  let index = 0;

  for (const [key, item] of value) {
    const keyIssue = persistedValueIssue(key, `${path}.<key:${index}>`, seen, false);

    if (keyIssue !== undefined) {
      return keyIssue;
    }

    const itemIssue = persistedValueIssue(item, `${path}.<value:${index}>`, seen, false);

    if (itemIssue !== undefined) {
      return itemIssue;
    }

    index++;
  }

  return undefined;
}

function persistedSetIssue(
  value: ReadonlySet<unknown>,
  path: string,
  seen: WeakSet<object>,
): ValueIssue | undefined {
  let index = 0;

  for (const item of value) {
    const issue = persistedValueIssue(item, `${path}.<value:${index}>`, seen, false);

    if (issue !== undefined) {
      return issue;
    }

    index++;
  }

  return undefined;
}

function unsupportedUndefinedIssue(path: string): ValueIssue {
  return { path, message: "undefined is not supported here" };
}
