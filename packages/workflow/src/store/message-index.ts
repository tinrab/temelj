import type { EventRecord, MessageSentEvent } from "../types/events.ts";
import type { RunId } from "../types/run.ts";
import type { WorkflowMessageIdempotencyIndex, WorkflowStorage } from "../types/store.ts";
import type { WorkflowEventAppendSuccessOutcome } from "./event-append.ts";

import { WorkflowMessageIdempotencyConflictError } from "../errors/mod.ts";
import { WorkflowHistory } from "../history/mod.ts";
import { makeEventsKey, makeMessageIdempotencyKey } from "../store-keys.ts";
import { supportsWorkflowConditionalWrite } from "./capabilities.ts";
import { getStoredEventHistory, rollbackAppendedEventIfCurrent } from "./event-history.ts";
import { isSameWorkflowStorageValue } from "./revision.ts";
import { requireReadableStoredWorkflowRun } from "./run.ts";
import { toStorageValue } from "./storage-value.ts";
import { isSameMessageIdempotencyIndex } from "./validation.ts";

export interface WorkflowDuplicateMessageAppendOutcome {
  readonly status: "duplicate";
  readonly events: readonly EventRecord[];
}

export function duplicateMessageAppendOutcome(
  runId: RunId,
  events: readonly EventRecord[],
  event: EventRecord,
): WorkflowDuplicateMessageAppendOutcome | undefined {
  if (!isMessageIdempotencyEvent(event)) {
    return undefined;
  }
  const existing = new WorkflowHistory(events).messageByIdempotencyKey(event.idempotencyKey);
  if (existing === undefined) {
    return undefined;
  }
  requireDuplicateMessageEventMatches(runId, existing, event);
  return { status: "duplicate", events };
}

function isMessageIdempotencyEvent(
  event: EventRecord,
): event is MessageSentEvent & { readonly idempotencyKey: string } {
  return event.kind === "message_sent" && event.idempotencyKey !== undefined;
}

function requireDuplicateMessageEventMatches(
  runId: RunId,
  existing: MessageSentEvent,
  event: MessageSentEvent & { readonly idempotencyKey: string },
): void {
  if (
    existing.messageId === event.messageId &&
    isSameWorkflowStorageValue(existing.payload, event.payload)
  ) {
    return;
  }
  // Message idempotency keys protect the target run from receiving two distinct logical messages under the same caller-supplied key.
  WorkflowMessageIdempotencyConflictError.conflict({
    runId,
    messageId: existing.messageId,
    idempotencyKey: event.idempotencyKey,
  });
}

async function indexMessageIdempotencyKey(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  events: readonly EventRecord[],
): Promise<void> {
  if (event.kind !== "message_sent" || event.idempotencyKey === undefined) {
    return;
  }
  await requireReadableStoredWorkflowRun(storage, namespace, runId);

  const indexedEvent = indexableMessageEventByIdempotencyKey(
    new WorkflowHistory(events),
    event.idempotencyKey,
  );
  if (indexedEvent === undefined) {
    return;
  }

  // The index is a derived fast path for duplicate message sends.
  // The event history remains the source of truth, so indexing the same event twice is harmless but conflicting values are not.
  const key = makeMessageIdempotencyKey(namespace, runId, event.idempotencyKey);
  const value = {
    runId,
    messageId: indexedEvent.messageId,
    timestamp: indexedEvent.timestamp,
  };
  if (!supportsWorkflowConditionalWrite(storage)) {
    const current = await storage.get(key);
    if (current !== undefined) {
      if (isSameMessageIdempotencyIndex(current, value)) {
        return;
      }
      WorkflowMessageIdempotencyConflictError.conflict({
        runId,
        messageId: indexedEvent.messageId,
        idempotencyKey: event.idempotencyKey,
      });
    }
    await storage.set(key, toStorageValue(value));
    return;
  }

  const indexed = await storage.compareAndSet(key, undefined, toStorageValue(value));
  if (indexed) {
    return;
  }

  const current = await storage.get(key);
  if (isSameMessageIdempotencyIndex(current, value)) {
    return;
  }

  WorkflowMessageIdempotencyConflictError.conflict({
    runId,
    messageId: indexedEvent.messageId,
    idempotencyKey: event.idempotencyKey,
  });
}

export async function projectMessageIdempotencyIndexForAppendOutcome(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  outcome: WorkflowEventAppendSuccessOutcome,
): Promise<readonly EventRecord[]> {
  try {
    await indexMessageIdempotencyKey(storage, namespace, runId, event, outcome.events);
  } catch (error) {
    if (outcome.status === "appended") {
      await rollbackAppendedEventIfCurrent(
        storage,
        namespace,
        runId,
        outcome.events,
        outcome.previousEventHistory,
      );
    }
    throw error;
  }
  return outcome.events;
}

export async function reconcileMessageIdempotencyIndexes(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  events: readonly EventRecord[],
): Promise<readonly WorkflowMessageIdempotencyIndex[]> {
  await requireReadableStoredWorkflowRun(storage, namespace, runId);

  const indexes = messageIdempotencyIndexValuesFromEvents(events, runId);
  await Promise.all(
    indexes.map(async ({ idempotencyKey, value }) => {
      await storeMessageIdempotencyIndex(storage, namespace, runId, idempotencyKey, value);
    }),
  );
  return indexes.map((index) => index.value);
}

export async function repairMessageIdempotencyIndexes(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<readonly WorkflowMessageIdempotencyIndex[]> {
  await requireReadableStoredWorkflowRun(storage, namespace, runId);
  return await reconcileMessageIdempotencyIndexes(
    storage,
    namespace,
    runId,
    (await getStoredEventHistory(storage, makeEventsKey(namespace, runId))).events,
  );
}

export async function hasMessageIdempotencyKey(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  idempotencyKey: string,
): Promise<boolean> {
  return (
    (await storage.get(makeMessageIdempotencyKey(namespace, runId, idempotencyKey))) !== undefined
  );
}

function indexableMessageEventByIdempotencyKey(
  history: WorkflowHistory,
  idempotencyKey: string,
): MessageSentEvent | undefined {
  const event = history.messageByIdempotencyKey(idempotencyKey);
  return event !== undefined && isIndexableMessageIdempotencyEvent(event) ? event : undefined;
}

export function messageIdempotencyIndexValuesFromEvents(
  events: readonly EventRecord[],
  runId: RunId,
): readonly {
  readonly idempotencyKey: string;
  readonly value: WorkflowMessageIdempotencyIndex;
}[] {
  return new WorkflowHistory(events)
    .latestMessagesByIdempotencyKey()
    .filter(isIndexableMessageIdempotencyEvent)
    .map((event) => ({
      idempotencyKey: event.idempotencyKey,
      value: {
        runId,
        messageId: event.messageId,
        timestamp: event.timestamp,
      },
    }));
}

function isIndexableMessageIdempotencyEvent(event: EventRecord): event is MessageSentEvent & {
  readonly idempotencyKey: string;
  readonly messageId: string;
} {
  return (
    event.kind === "message_sent" &&
    event.idempotencyKey !== undefined &&
    typeof event.messageId === "string" &&
    event.messageId.trim() !== ""
  );
}

async function storeMessageIdempotencyIndex(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  idempotencyKey: string,
  value: WorkflowMessageIdempotencyIndex,
): Promise<void> {
  const key = makeMessageIdempotencyKey(namespace, runId, idempotencyKey);
  const current = await storage.get(key);
  if (isSameMessageIdempotencyIndex(current, value)) {
    return;
  }

  if (!supportsWorkflowConditionalWrite(storage)) {
    await storage.set(key, toStorageValue(value));
    return;
  }
  const stored = await storage.compareAndSet(key, current, toStorageValue(value));
  if (!stored) {
    WorkflowMessageIdempotencyConflictError.conflict({
      runId,
      messageId: value.messageId,
      idempotencyKey,
    });
  }
}
