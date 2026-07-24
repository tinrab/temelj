import type { StorageCompareAndSetManyItem, StorageValue } from "@temelj/storage";

import type { EventRecord } from "../types/events.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowStorage } from "../types/store.ts";

import { getEventDescriptor, isCleanupEventRecord } from "../events/descriptors.ts";
import { makeEventsKey } from "../store-keys.ts";
import { supportsWorkflowConditionalWrite } from "./capabilities.ts";
import { isSameWorkflowStorageValue } from "./revision.ts";
import { toStorageValue } from "./storage-value.ts";
import { isReadableEventRecord } from "./validation.ts";

type WorkflowEventHistoryCompareAndSetItem = StorageCompareAndSetManyItem<StorageValue>;
type WorkflowRunRevisionCompareAndSetItem = StorageCompareAndSetManyItem<StorageValue>;

export async function getStoredEventHistory(
  storage: WorkflowStorage,
  key: string,
): Promise<{
  readonly raw: StorageValue | undefined;
  readonly events: readonly EventRecord[];
}> {
  const raw = await storage.get(key);
  return {
    raw,
    events: Array.isArray(raw) ? raw.filter(isReadableEventRecord) : [],
  };
}

export async function getStoredCleanupEventHistory(
  storage: WorkflowStorage,
  key: string,
): Promise<{
  readonly raw: StorageValue | undefined;
  readonly events: readonly EventRecord[];
}> {
  const history = await getStoredEventHistory(storage, key);
  return {
    raw: history.raw,
    events: history.events.filter(isCleanupEventRecord),
  };
}

export function isSameWorkflowEventIdentity(left: EventRecord, right: EventRecord): boolean {
  // Event identity is deliberately narrower than record equality.
  // Replayed writes can carry equivalent storage values and still represent the same durable event.
  if (left.kind !== right.kind || Temporal.Instant.compare(left.timestamp, right.timestamp) !== 0) {
    return false;
  }

  const descriptor = getEventDescriptor(left.kind);
  return (
    isSameWorkflowEventFields(left, right, descriptor.identityFields) &&
    isSameWorkflowEventValueFields(left, right, descriptor.valueIdentityFields) &&
    isSameWorkflowEventStringListFields(left, right, descriptor.stringListIdentityFields)
  );
}

function isSameWorkflowEventFields(
  left: EventRecord,
  right: EventRecord,
  fields: readonly string[] = [],
): boolean {
  return fields.every((field) => Reflect.get(left, field) === Reflect.get(right, field));
}

function isSameWorkflowEventValueFields(
  left: EventRecord,
  right: EventRecord,
  fields: readonly string[] = [],
): boolean {
  return fields.every((field) =>
    isSameWorkflowStorageValue(Reflect.get(left, field), Reflect.get(right, field)),
  );
}

function isSameWorkflowEventStringListFields(
  left: EventRecord,
  right: EventRecord,
  fields: readonly string[] = [],
): boolean {
  return fields.every((field) => {
    const leftValue = Reflect.get(left, field);
    const rightValue = Reflect.get(right, field);
    const leftValues =
      Array.isArray(leftValue) &&
      leftValue.every((item) => typeof item === "string" && item.trim() !== "")
        ? leftValue
        : undefined;
    const rightValues =
      Array.isArray(rightValue) &&
      rightValue.every((item) => typeof item === "string" && item.trim() !== "")
        ? rightValue
        : undefined;
    if (leftValues === undefined || rightValues === undefined) {
      return leftValues === rightValues;
    }
    if (leftValues.length !== rightValues.length) {
      return false;
    }
    return leftValues.every((value, index) => value === rightValues[index]);
  });
}

export async function rollbackAppendedEventIfCurrent(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  expectedEvents: readonly EventRecord[],
  previousEventHistory?: StorageValue,
): Promise<boolean> {
  if (expectedEvents.length === 0) {
    return false;
  }

  const key = makeEventsKey(namespace, runId);
  const rolledBackEvents = expectedEvents.slice(0, -1);
  if (supportsWorkflowConditionalWrite(storage)) {
    return await storage.compareAndSet(
      key,
      toStorageValue(expectedEvents),
      previousEventHistory ?? toStorageValue(rolledBackEvents),
    );
  }

  const current = (await getStoredEventHistory(storage, key)).events;
  const expectedLast = expectedEvents.at(-1);
  const currentLast = current.at(-1);
  // Without CAS we can only roll back when the history still ends with the event we appended.
  // If another writer has appended after us, rollback would remove their event too.
  if (
    current.length !== expectedEvents.length ||
    expectedLast === undefined ||
    currentLast === undefined ||
    !isSameWorkflowEventIdentity(currentLast, expectedLast)
  ) {
    return false;
  }

  await storage.set(key, previousEventHistory ?? toStorageValue(rolledBackEvents));
  return true;
}

export function createWorkflowEventHistoryCompareAndSetItem(
  eventsStorageKey: string,
  expected: StorageValue | undefined,
  events: readonly EventRecord[],
): WorkflowEventHistoryCompareAndSetItem {
  return {
    key: eventsStorageKey,
    expected,
    value: toStorageValue(events),
  };
}

function createWorkflowRunRevisionCompareAndSetItem(
  runStorageKey: string,
  currentRun: WorkflowRunRecord,
): WorkflowRunRevisionCompareAndSetItem {
  const value = toStorageValue(currentRun);
  return {
    key: runStorageKey,
    expected: value,
    value,
  };
}

export function createRunRevisionGuardedEventHistoryCompareAndSetItems(
  runStorageKey: string,
  currentRun: WorkflowRunRecord,
  eventsStorageKey: string,
  expectedEvents: StorageValue | undefined,
  events: readonly EventRecord[],
): readonly [WorkflowRunRevisionCompareAndSetItem, WorkflowEventHistoryCompareAndSetItem] {
  return [
    createWorkflowRunRevisionCompareAndSetItem(runStorageKey, currentRun),
    createWorkflowEventHistoryCompareAndSetItem(eventsStorageKey, expectedEvents, events),
  ];
}
