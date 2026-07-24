import type { StorageValue } from "@temelj/storage";

import type { EventRecord } from "../../src/types/events.ts";
import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { isReadableEventRecord, parseStoredWorkflowRunRecord } from "../../src/store/validation.ts";

export type WorkflowStorageValueReader = (key: string) => Promise<StorageValue | undefined>;

export function storageValue(value: unknown): StorageValue {
  return value as StorageValue;
}

export function eventHistoryStorageValue(
  events: readonly (EventRecord | Record<string, unknown>)[],
): StorageValue {
  return storageValue(events);
}

export function runRecordStorageValue(
  run: WorkflowRunRecord | Record<string, unknown>,
): StorageValue {
  return storageValue(run);
}

export async function readWorkflowEventHistoryStorageValue(
  get: WorkflowStorageValueReader,
  key: string,
): Promise<readonly EventRecord[]> {
  const value = await get(key);
  return value === undefined ? [] : workflowEventHistoryStorageValue(value);
}

export async function readWorkflowRunRecordStorageValue(
  get: WorkflowStorageValueReader,
  key: string,
): Promise<WorkflowRunRecord | undefined> {
  return parseStoredWorkflowRunRecord(await get(key));
}

function workflowEventHistoryStorageValue(value: StorageValue): readonly EventRecord[] {
  return Array.isArray(value) ? value.filter(isReadableEventRecord) : [];
}
