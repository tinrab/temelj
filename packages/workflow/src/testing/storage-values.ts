import type { StorageValue } from "@temelj/storage";

import type { EventRecord } from "../types/events.ts";
import type { RunRecord } from "../types/run.ts";

import { toStorageValue } from "../store/storage-value.ts";
import { isReadableEventRecord } from "../store/validation.ts";

type StorageValueReader = (key: string) => Promise<StorageValue | undefined>;

export function eventHistoryStorageValue(
  events: readonly (EventRecord | StorageValue)[],
): StorageValue {
  return toStorageValue(events);
}

export function runRecordStorageValue(run: RunRecord | StorageValue): StorageValue {
  return toStorageValue(run);
}

export async function readEventHistoryStorageValue(
  get: StorageValueReader,
  key: string,
): Promise<readonly EventRecord[]> {
  const value = await get(key);

  return value === undefined ? [] : workflowEventHistoryStorageValue(value);
}

function workflowEventHistoryStorageValue(value: StorageValue): readonly EventRecord[] {
  return Array.isArray(value) ? value.filter(isReadableEventRecord) : [];
}
