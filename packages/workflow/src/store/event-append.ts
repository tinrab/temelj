import type { StorageCompareAndSetManyItem, StorageValue } from "@temelj/storage";

import type { EventRecord } from "../types/events.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowStorage } from "../types/store.ts";

import { WorkflowStateError } from "../errors/mod.ts";
import { makeEventsKey, makeRunKey } from "../store-keys.ts";
import {
  supportsWorkflowAtomicBatchWrite,
  supportsWorkflowConditionalWrite,
} from "./capabilities.ts";
import {
  createRunRevisionGuardedEventHistoryCompareAndSetItems,
  createWorkflowEventHistoryCompareAndSetItem,
  getStoredEventHistory,
} from "./event-history.ts";
import { toStorageValue } from "./storage-value.ts";

const MAX_APPEND_EVENT_ATTEMPTS = 16;

export type WorkflowEventAppendSuccessOutcome =
  | {
      readonly status: "appended";
      readonly events: readonly EventRecord[];
      readonly previousEventHistory?: StorageValue;
    }
  | {
      readonly status: "duplicate";
      readonly events: readonly EventRecord[];
    };

export type WorkflowEventAppendOutcome =
  | WorkflowEventAppendSuccessOutcome
  | {
      readonly status: "staleRun";
    };

export type WorkflowEventAppendedOutcome = Extract<
  WorkflowEventAppendSuccessOutcome,
  { readonly status: "appended" }
>;

interface WorkflowEventAppendAtomicProjectionPlan {
  readonly item?: StorageCompareAndSetManyItem<StorageValue>;
}

export type WorkflowEventAppendAtomicProjectionPlanner = (
  attempt: number,
) => Promise<WorkflowEventAppendAtomicProjectionPlan | undefined>;

export type WorkflowEventAppendDuplicateDetector = (
  runId: RunId,
  events: readonly EventRecord[],
  event: EventRecord,
) => Extract<WorkflowEventAppendSuccessOutcome, { readonly status: "duplicate" }> | undefined;

interface EventAppendOptions {
  readonly detectDuplicate?: WorkflowEventAppendDuplicateDetector;
  readonly previousEventHistory?: StorageValue;
}

interface WorkflowEventAppendState {
  readonly raw: StorageValue | undefined;
  readonly currentEvents: readonly EventRecord[];
  readonly duplicate?: Extract<WorkflowEventAppendSuccessOutcome, { readonly status: "duplicate" }>;
  readonly nextEvents: readonly EventRecord[];
}

function makeAppendedEventOutcome(
  events: readonly EventRecord[],
  previousEventHistory?: StorageValue,
): WorkflowEventAppendedOutcome {
  return {
    status: "appended",
    events,
    ...(previousEventHistory === undefined ? {} : { previousEventHistory }),
  };
}

export function makeStaleRunAppendOutcome(): WorkflowEventAppendOutcome {
  return { status: "staleRun" };
}

export async function appendEventWithAtomicProjectionPlan(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  planProjection?: WorkflowEventAppendAtomicProjectionPlanner,
  detectDuplicate?: WorkflowEventAppendDuplicateDetector,
): Promise<WorkflowEventAppendSuccessOutcome> {
  if (!supportsWorkflowAtomicBatchWrite(storage)) {
    const previousEventHistory = await storage.get(makeEventsKey(namespace, runId));
    return await appendEventIfCurrent(storage, namespace, runId, event, {
      detectDuplicate,
      previousEventHistory,
    });
  }

  const eventsStorageKey = makeEventsKey(namespace, runId);

  for (let attempt = 0; attempt < MAX_APPEND_EVENT_ATTEMPTS; attempt++) {
    const appendState = await readWorkflowEventAppendState(
      storage,
      eventsStorageKey,
      runId,
      event,
      detectDuplicate,
    );
    const duplicate = appendState.duplicate;
    if (duplicate !== undefined) {
      return duplicate;
    }

    const projectionPlan = await planProjection?.(attempt);
    const items = [
      createWorkflowEventHistoryCompareAndSetItem(
        eventsStorageKey,
        appendState.raw,
        appendState.nextEvents,
      ),
      ...(projectionPlan?.item === undefined ? [] : [projectionPlan.item]),
    ];
    const updated = await storage.compareAndSetMany(items);
    if (updated) {
      return makeAppendedEventOutcome(appendState.nextEvents, appendState.raw);
    }
  }

  WorkflowStateError.failedWorkflowEventAppend(runId, MAX_APPEND_EVENT_ATTEMPTS);
}

export async function appendEventIfRunRevisionCurrentAtomically(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: WorkflowRunRecord,
  event: EventRecord,
  detectDuplicate?: WorkflowEventAppendDuplicateDetector,
): Promise<WorkflowEventAppendOutcome> {
  const runId = currentRun.id;
  const runStorageKey = makeRunKey(namespace, runId);
  const eventsStorageKey = makeEventsKey(namespace, runId);

  for (let attempt = 0; attempt < MAX_APPEND_EVENT_ATTEMPTS; attempt++) {
    const appendState = await readWorkflowEventAppendState(
      storage,
      eventsStorageKey,
      runId,
      event,
      detectDuplicate,
    );
    const duplicate = appendState.duplicate;
    if (duplicate !== undefined) {
      const unchanged = await storage.compareAndSetMany(
        createRunRevisionGuardedEventHistoryCompareAndSetItems(
          runStorageKey,
          currentRun,
          eventsStorageKey,
          appendState.raw,
          appendState.currentEvents,
        ),
      );
      if (unchanged) {
        return duplicate;
      }
      continue;
    }
    const updated = await storage.compareAndSetMany(
      createRunRevisionGuardedEventHistoryCompareAndSetItems(
        runStorageKey,
        currentRun,
        eventsStorageKey,
        appendState.raw,
        appendState.nextEvents,
      ),
    );
    if (updated) {
      return makeAppendedEventOutcome(appendState.nextEvents, appendState.raw);
    }
    if (event.kind === "message_sent") {
      return makeStaleRunAppendOutcome();
    }
  }

  return makeStaleRunAppendOutcome();
}

export async function appendEventIfCurrent(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  options: EventAppendOptions = {},
): Promise<WorkflowEventAppendSuccessOutcome> {
  const key = makeEventsKey(namespace, runId);

  if (!supportsWorkflowConditionalWrite(storage)) {
    const current = (await getStoredEventHistory(storage, key)).events;
    const duplicate = options.detectDuplicate?.(runId, current, event);
    if (duplicate !== undefined) {
      return duplicate;
    }
    const events = [...current, event];
    await storage.set(key, toStorageValue(events));
    return makeAppendedEventOutcome(events, options.previousEventHistory);
  }

  for (let attempt = 0; attempt < MAX_APPEND_EVENT_ATTEMPTS; attempt++) {
    const appendState = await readWorkflowEventAppendState(
      storage,
      key,
      runId,
      event,
      options.detectDuplicate,
    );
    const duplicate = appendState.duplicate;
    if (duplicate !== undefined) {
      return duplicate;
    }
    const updated = await storage.compareAndSet(
      key,
      appendState.raw,
      toStorageValue(appendState.nextEvents),
    );
    if (updated) {
      return makeAppendedEventOutcome(appendState.nextEvents, appendState.raw);
    }
  }

  WorkflowStateError.failedWorkflowEventAppend(runId, MAX_APPEND_EVENT_ATTEMPTS);
}

async function readWorkflowEventAppendState(
  storage: WorkflowStorage,
  eventsStorageKey: string,
  runId: RunId,
  event: EventRecord,
  detectDuplicate?: WorkflowEventAppendDuplicateDetector,
): Promise<WorkflowEventAppendState> {
  const { raw, events: currentEvents } = await getStoredEventHistory(storage, eventsStorageKey);
  const duplicate = detectDuplicate?.(runId, currentEvents, event);
  return {
    raw,
    currentEvents,
    ...(duplicate === undefined ? {} : { duplicate }),
    nextEvents: duplicate === undefined ? [...currentEvents, event] : currentEvents,
  };
}
