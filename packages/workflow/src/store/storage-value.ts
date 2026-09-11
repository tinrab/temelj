import type { StorageValue } from "@temelj/storage";

import { isPlainObject } from "@temelj/value";

import { workflowPersistedValueSchema } from "../types/run.ts";

/** Validates storage writes and omits undefined optional fields from workflow records. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Storage adapters validate domain records before converting them to persisted values.
export function toStorageValue(value: unknown): StorageValue {
  return normalizeStoredWorkflowValue(value, new WeakSet<object>());
}

function normalizeStoredWorkflowValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Recursive storage parsing inspects each record field before returning StorageValue.
  value: unknown,
  active: WeakSet<object>,
): StorageValue {
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return workflowPersistedValueSchema.parse(value);
  }

  if (active.has(value)) throw new TypeError("Circular workflow records cannot be stored");
  active.add(value);

  try {
    if (Array.isArray(value)) {
      return Array.from(value, (item) => normalizeStoredWorkflowValue(item, active));
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
        .map(([key, item]) => [key, normalizeStoredWorkflowValue(item, active)]),
    );
  } finally {
    active.delete(value);
  }
}
