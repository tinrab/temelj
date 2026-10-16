import type { StorageValue } from "@temelj/storage";

import { isPlainObject } from "@temelj/value";

import { parse } from "../schema/common.ts";
import { persistedValueSchema } from "../schema/persisted-value.ts";

/** Validates storage writes and omits undefined optional fields from workflow records. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Storage adapters validate domain records before converting them to persisted values.
export function toStorageValue(value: unknown): StorageValue {
  return normalizeStoredValue(value, new WeakSet<object>());
}

function normalizeStoredValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Recursive storage parsing inspects each record field before returning StorageValue.
  value: unknown,
  active: WeakSet<object>,
): StorageValue {
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return parse(persistedValueSchema, value);
  }

  if (active.has(value)) throw new TypeError("Circular workflow records cannot be stored");
  active.add(value);

  try {
    if (Array.isArray(value)) {
      return Array.from(value, (item) => normalizeStoredValue(item, active));
    }

    if (
      Object.getOwnPropertySymbols(value).some((key) =>
        Object.prototype.propertyIsEnumerable.call(value, key),
      )
    ) {
      throw new TypeError("Symbol keys cannot be stored in workflow records");
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, normalizeStoredValue(item, active)]),
    );
  } finally {
    active.delete(value);
  }
}
