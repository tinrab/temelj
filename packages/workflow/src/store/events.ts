import type { StorageCompareAndSetManyItem, StorageValue } from "@temelj/storage";

import { deepEquals, isString } from "@temelj/value";

import type { EventRecord, EventFieldName } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { RunRecord } from "../types/run.ts";
import type { WorkflowStorage } from "../types/store.ts";
import type { StepAttemptMaterializationStoragePlan } from "./materialization.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowStateError } from "../errors/mod.ts";
import {
  getEventDescriptor,
  getEventField,
  isCleanupEventRecord,
  eventFieldsMatch,
} from "../events/descriptors.ts";
import { makeEventsKey, makeRunKey } from "../store-keys.ts";
import { supportsAtomicBatchWrite, supportsConditionalWrite } from "./capabilities.ts";
import {
  duplicateMessageAppendOutcome,
  projectMessageIdempotencyIndexForAppendOutcome,
} from "./indexes.ts";
import {
  createStepAttemptMaterializationStoragePlan,
  materializeStepAttemptForAppendOutcome,
} from "./materialization.ts";
import {
  requireReadableStoredRun,
  isStoredRunRevisionCurrent,
  isRunStaleForAppend,
  rollbackAppendedEventIfRunStale,
} from "./run.ts";
import { toStorageValue } from "./storage-value.ts";
import { requireReadableStoreRun, isReadableEventRecord } from "./validation.ts";

function finalizeAppendOutcome(
  outcome: EventAppendSuccessOutcome,
  projectionPipeline: AppendProjectionPipeline,
): Promise<readonly EventRecord[]>;
function finalizeAppendOutcome(
  outcome: EventAppendOutcome,
  projectionPipeline?: AppendProjectionPipeline,
): Promise<readonly EventRecord[] | undefined>;
async function finalizeAppendOutcome(
  outcome: EventAppendOutcome,
  projectionPipeline?: AppendProjectionPipeline,
): Promise<readonly EventRecord[] | undefined> {
  if (outcome.status === "staleRun") {
    return undefined;
  }

  if (projectionPipeline === undefined) {
    throw new WorkflowStateError(
      "Cannot finalize workflow event append without an append projection pipeline.",
      { code: WorkflowErrorCode.STATE_APPEND_PROJECTION_PIPELINE_MISSING },
    );
  }

  return await projectionPipeline.finalize(outcome);
}

export async function appendWorkflowEvent(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
): Promise<readonly EventRecord[]> {
  await requireReadableStoredRun(storage, namespace, runId);

  const projectionPipeline = await createAppendProjectionPipeline(storage, namespace, runId, event);

  const outcome = await appendEventWithProjections(
    storage,
    namespace,
    runId,
    event,
    projectionPipeline,
  );

  return await finalizeAppendOutcome(outcome, projectionPipeline);
}

export async function appendWorkflowEventIfRunCurrent(
  storage: WorkflowStorage,
  namespace: string,
  current: RunRecord,
  event: EventRecord,
): Promise<readonly EventRecord[] | undefined> {
  requireReadableStoreRun(current, namespace);

  const appendOutcome = await appendEventWithProjectionPipelineIfRunCurrent(
    storage,
    namespace,
    current,
    event,
  );

  return await finalizeAppendOutcome(appendOutcome.outcome, appendOutcome.projectionPipeline);
}

export async function getWorkflowEvents(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<readonly EventRecord[]> {
  return (await getStoredEventHistory(storage, makeEventsKey(namespace, runId))).events;
}

const MAX_APPEND_EVENT_ATTEMPTS = 16;

export type EventAppendSuccessOutcome =
  | {
      readonly status: "appended";
      readonly events: readonly EventRecord[];
      readonly previousEventHistory?: StorageValue;
    }
  | {
      readonly status: "duplicate";
      readonly events: readonly EventRecord[];
    };

type EventAppendOutcome =
  | EventAppendSuccessOutcome
  | {
      readonly status: "staleRun";
    };

type EventAppendedOutcome = Extract<EventAppendSuccessOutcome, { readonly status: "appended" }>;

interface EventAppendAtomicProjectionPlan {
  readonly item?: StorageCompareAndSetManyItem<StorageValue>;
}

type EventAppendAtomicProjectionPlanner = (
  attempt: number,
) => Promise<EventAppendAtomicProjectionPlan | undefined>;

type EventAppendDuplicateDetector = (
  runId: RunId,
  events: readonly EventRecord[],
  event: EventRecord,
) => Extract<EventAppendSuccessOutcome, { readonly status: "duplicate" }> | undefined;

interface EventAppendOptions {
  readonly detectDuplicate?: EventAppendDuplicateDetector;
  readonly previousEventHistory?: StorageValue;
}

interface EventAppendState {
  readonly raw: StorageValue | undefined;
  readonly currentEvents: readonly EventRecord[];
  readonly duplicate?: Extract<EventAppendSuccessOutcome, { readonly status: "duplicate" }>;
  readonly nextEvents: readonly EventRecord[];
}

function makeAppendedEventOutcome(
  events: readonly EventRecord[],
  previousEventHistory?: StorageValue,
): EventAppendedOutcome {
  return {
    status: "appended",
    events,
    previousEventHistory,
  };
}

function makeStaleRunAppendOutcome(): EventAppendOutcome {
  return { status: "staleRun" };
}

async function appendEventWithAtomicProjectionPlan(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  planProjection?: EventAppendAtomicProjectionPlanner,
  detectDuplicate?: EventAppendDuplicateDetector,
): Promise<EventAppendSuccessOutcome> {
  if (!supportsAtomicBatchWrite(storage)) {
    const previousEventHistory = await storage.get(makeEventsKey(namespace, runId));

    return await appendEventIfCurrent(storage, namespace, runId, event, {
      detectDuplicate,
      previousEventHistory,
    });
  }

  const eventsStorageKey = makeEventsKey(namespace, runId);

  return await retryEventAppend(
    storage,
    eventsStorageKey,
    runId,
    event,
    detectDuplicate,
    async (appendState, attempt) => {
      const projectionPlan = await planProjection?.(attempt);

      return await storage.compareAndSetMany([
        createEventHistoryCompareAndSetItem(
          eventsStorageKey,
          appendState.raw,
          appendState.nextEvents,
        ),
        ...(projectionPlan?.item === undefined ? [] : [projectionPlan.item]),
      ]);
    },
  );
}

async function appendEventIfRunRevisionCurrentAtomically(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: RunRecord,
  event: EventRecord,
  detectDuplicate?: EventAppendDuplicateDetector,
): Promise<EventAppendOutcome> {
  const runId = currentRun.id;
  const runStorageKey = makeRunKey(namespace, runId);
  const eventsStorageKey = makeEventsKey(namespace, runId);

  for (let attempt = 0; attempt < MAX_APPEND_EVENT_ATTEMPTS; attempt++) {
    const appendState = await readEventAppendState(
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

async function appendEventIfCurrent(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  options: EventAppendOptions = {},
): Promise<EventAppendSuccessOutcome> {
  const key = makeEventsKey(namespace, runId);

  if (!supportsConditionalWrite(storage)) {
    const current = (await getStoredEventHistory(storage, key)).events;
    const duplicate = options.detectDuplicate?.(runId, current, event);

    if (duplicate !== undefined) {
      return duplicate;
    }

    const events = [...current, event];
    await storage.set(key, toStorageValue(events));

    return makeAppendedEventOutcome(events, options.previousEventHistory);
  }

  return await retryEventAppend(
    storage,
    key,
    runId,
    event,
    options.detectDuplicate,
    async (appendState) =>
      await storage.compareAndSet(key, appendState.raw, toStorageValue(appendState.nextEvents)),
  );
}

/**
 * Reads the event history, returns a detected duplicate, and otherwise retries `write` until it
 * lands or the attempts run out.
 */
async function retryEventAppend(
  storage: WorkflowStorage,
  key: string,
  runId: RunId,
  event: EventRecord,
  detectDuplicate: EventAppendDuplicateDetector | undefined,
  write: (appendState: EventAppendState, attempt: number) => Promise<boolean>,
): Promise<EventAppendSuccessOutcome> {
  for (let attempt = 0; attempt < MAX_APPEND_EVENT_ATTEMPTS; attempt++) {
    const appendState = await readEventAppendState(storage, key, runId, event, detectDuplicate);

    if (appendState.duplicate !== undefined) {
      return appendState.duplicate;
    }

    if (await write(appendState, attempt)) {
      return makeAppendedEventOutcome(appendState.nextEvents, appendState.raw);
    }
  }

  throw new WorkflowStateError(
    `Failed to append workflow event for run ${runId} after ${MAX_APPEND_EVENT_ATTEMPTS} attempts`,
    {
      code: WorkflowErrorCode.STATE_WORKFLOW_EVENT_APPEND_FAILED,
      details: { runId: runId, attempts: MAX_APPEND_EVENT_ATTEMPTS },
    },
  );
}

async function readEventAppendState(
  storage: WorkflowStorage,
  eventsStorageKey: string,
  runId: RunId,
  event: EventRecord,
  detectDuplicate?: EventAppendDuplicateDetector,
): Promise<EventAppendState> {
  const { raw, events: currentEvents } = await getStoredEventHistory(storage, eventsStorageKey);
  const duplicate = detectDuplicate?.(runId, currentEvents, event);

  return {
    raw,
    currentEvents,
    duplicate,
    nextEvents: duplicate === undefined ? [...currentEvents, event] : currentEvents,
  };
}

interface EventAppendProjectionOutcome {
  readonly outcome: EventAppendOutcome;
  readonly projectionPipeline?: AppendProjectionPipeline;
}

export async function appendEventWithProjections(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  projectionPipeline?: AppendProjectionPipeline,
): Promise<EventAppendSuccessOutcome> {
  const appendProjectionPipeline =
    projectionPipeline ?? (await createAppendProjectionPipeline(storage, namespace, runId, event));

  const outcome = await appendEventWithAtomicProjectionPlan(
    storage,
    namespace,
    runId,
    event,
    appendProjectionPipeline.planAtomicProjections,
    duplicateMessageAppendOutcome,
  );

  await appendProjectionPipeline.finalizePostCommit(outcome);

  return outcome;
}

export async function appendEventWithProjectionPipelineIfRunCurrent(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: RunRecord,
  event: EventRecord,
): Promise<EventAppendProjectionOutcome> {
  const runId = currentRun.id;

  if (isRunStaleForAppend(currentRun, event)) {
    return { outcome: makeStaleRunAppendOutcome() };
  }

  const projectionPipeline = await createAppendProjectionPipeline(storage, namespace, runId, event);

  if (event.kind === "message_sent" && !supportsAtomicBatchWrite(storage)) {
    return await appendMessageEventIfRunCurrent(
      storage,
      namespace,
      currentRun,
      event,
      projectionPipeline,
    );
  }

  if (!supportsAtomicBatchWrite(storage) || projectionPipeline.materializesAtomically) {
    const outcome = await appendEventIfRunRevisionCurrentWithPostAppendGuard(
      storage,
      namespace,
      currentRun,
      event,
      projectionPipeline,
    );

    return workflowEventAppendProjectionOutcome(outcome, projectionPipeline);
  }

  const outcome = await appendEventIfRunRevisionCurrentAtomically(
    storage,
    namespace,
    currentRun,
    event,
    duplicateMessageAppendOutcome,
  );

  return workflowEventAppendProjectionOutcome(outcome, projectionPipeline);
}

function workflowEventAppendProjectionOutcome(
  outcome: EventAppendOutcome,
  projectionPipeline?: AppendProjectionPipeline,
): EventAppendProjectionOutcome {
  if (projectionPipeline === undefined) {
    return { outcome };
  }

  return { outcome, projectionPipeline };
}

async function appendEventIfRunRevisionCurrentWithPostAppendGuard(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: RunRecord,
  event: EventRecord,
  projectionPipeline?: AppendProjectionPipeline,
): Promise<EventAppendOutcome> {
  const runId = currentRun.id;

  if (!(await isStoredRunRevisionCurrent(storage, namespace, currentRun))) {
    return makeStaleRunAppendOutcome();
  }

  const outcome = await appendEventWithProjections(
    storage,
    namespace,
    runId,
    event,
    projectionPipeline,
  );

  if (outcome.status !== "appended") {
    return outcome;
  }

  return await guardAppendedEventAgainstStaleRun(storage, namespace, runId, event, outcome);
}

async function appendMessageEventIfRunCurrent(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: RunRecord,
  event: EventRecord,
  projectionPipeline: AppendProjectionPipeline,
): Promise<EventAppendProjectionOutcome> {
  const runId = currentRun.id;

  if (!(await isStoredRunRevisionCurrent(storage, namespace, currentRun))) {
    return { outcome: makeStaleRunAppendOutcome() };
  }

  if (!supportsConditionalWrite(storage)) {
    const outcome = await appendEventWithProjections(
      storage,
      namespace,
      runId,
      event,
      projectionPipeline,
    );

    if (outcome.status !== "appended") {
      return { outcome, projectionPipeline };
    }

    return {
      outcome: await guardAppendedEventAgainstStaleRun(storage, namespace, runId, event, outcome),
      projectionPipeline,
    };
  }

  const outcome = await appendEventIfCurrent(storage, namespace, runId, event, {
    detectDuplicate: duplicateMessageAppendOutcome,
  });

  if (outcome.status !== "appended") {
    if (!(await isStoredRunRevisionCurrent(storage, namespace, currentRun))) {
      return { outcome: makeStaleRunAppendOutcome(), projectionPipeline };
    }

    return { outcome, projectionPipeline };
  }

  if (!(await isStoredRunRevisionCurrent(storage, namespace, currentRun))) {
    await guardAppendedEventAgainstStaleRun(storage, namespace, runId, event, outcome);

    return { outcome: makeStaleRunAppendOutcome(), projectionPipeline };
  }

  return {
    outcome: await guardAppendedEventAgainstStaleRun(storage, namespace, runId, event, outcome),
    projectionPipeline,
  };
}

async function guardAppendedEventAgainstStaleRun(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  outcome: EventAppendedOutcome,
): Promise<EventAppendOutcome> {
  if (await rollbackAppendedEventIfRunStale(storage, namespace, runId, event, outcome.events)) {
    return makeStaleRunAppendOutcome();
  }

  return outcome;
}

interface AppendProjectionPipeline {
  readonly materializesAtomically: boolean;
  readonly planAtomicProjections?: EventAppendAtomicProjectionPlanner;
  finalize(outcome: EventAppendSuccessOutcome): Promise<readonly EventRecord[]>;
  finalizePostCommit(outcome: EventAppendSuccessOutcome): Promise<void>;
}

async function createAppendProjectionPipeline(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
): Promise<AppendProjectionPipeline> {
  if (!supportsAtomicBatchWrite(storage)) {
    return createAppendProjectionPipelineFromStepAttemptPlan(
      storage,
      namespace,
      runId,
      event,
      undefined,
    );
  }

  const initialStepAttemptPlan = await createStepAttemptMaterializationStoragePlan(
    storage,
    namespace,
    runId,
    event,
  );

  return createAppendProjectionPipelineFromStepAttemptPlan(
    storage,
    namespace,
    runId,
    event,
    initialStepAttemptPlan,
  );
}

function createAppendProjectionPipelineFromStepAttemptPlan(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  initialStepAttemptPlan: StepAttemptMaterializationStoragePlan | undefined,
): AppendProjectionPipeline {
  return {
    materializesAtomically: initialStepAttemptPlan?.materializes === true,
    planAtomicProjections: createAppendAtomicProjectionPlanner(
      storage,
      namespace,
      runId,
      event,
      initialStepAttemptPlan,
    ),
    async finalize(outcome) {
      return await projectMessageIdempotencyIndexForAppendOutcome(
        storage,
        namespace,
        runId,
        event,
        outcome,
      );
    },
    async finalizePostCommit(outcome) {
      if (!supportsAtomicBatchWrite(storage)) {
        await materializeStepAttemptForAppendOutcome(storage, namespace, runId, event, outcome);
      }
    },
  };
}

function createAppendAtomicProjectionPlanner(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  initialStepAttemptPlan?: StepAttemptMaterializationStoragePlan,
): EventAppendAtomicProjectionPlanner | undefined {
  if (!supportsAtomicBatchWrite(storage)) {
    return undefined;
  }

  return async (attempt) =>
    attempt === 0 && initialStepAttemptPlan !== undefined
      ? initialStepAttemptPlan
      : await createStepAttemptMaterializationStoragePlan(storage, namespace, runId, event);
}

type EventHistoryCompareAndSetItem = StorageCompareAndSetManyItem<StorageValue>;

type RunRevisionCompareAndSetItem = StorageCompareAndSetManyItem<StorageValue>;

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

export function isSameEventIdentity(left: EventRecord, right: EventRecord): boolean {
  // Event identity is deliberately narrower than record equality.
  // Replayed writes can carry equivalent storage values and still represent the same durable event.
  if (left.kind !== right.kind || Temporal.Instant.compare(left.timestamp, right.timestamp) !== 0) {
    return false;
  }

  const descriptor = getEventDescriptor(left.kind);

  return (
    eventFieldsMatch(left, right, descriptor.identityFields) &&
    isSameEventValueFields(left, right, descriptor.valueIdentityFields) &&
    isSameEventStringListFields(left, right, descriptor.stringListIdentityFields)
  );
}

function isSameEventValueFields(
  left: EventRecord,
  right: EventRecord,
  fields: readonly EventFieldName[] = [],
): boolean {
  return fields.every((field) =>
    deepEquals(getEventField(left, field), getEventField(right, field)),
  );
}

function isSameEventStringListFields(
  left: EventRecord,
  right: EventRecord,
  fields: readonly EventFieldName[] = [],
): boolean {
  return fields.every((field) => {
    const leftValue = getEventField(left, field);
    const rightValue = getEventField(right, field);

    const leftValues =
      Array.isArray(leftValue) && leftValue.every((item) => isString(item) && item.trim() !== "")
        ? leftValue
        : undefined;

    const rightValues =
      Array.isArray(rightValue) && rightValue.every((item) => isString(item) && item.trim() !== "")
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

  if (supportsConditionalWrite(storage)) {
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
    !isSameEventIdentity(currentLast, expectedLast)
  ) {
    return false;
  }

  await storage.set(key, previousEventHistory ?? toStorageValue(rolledBackEvents));

  return true;
}

function createEventHistoryCompareAndSetItem(
  eventsStorageKey: string,
  expected: StorageValue | undefined,
  events: readonly EventRecord[],
): EventHistoryCompareAndSetItem {
  return {
    key: eventsStorageKey,
    expected,
    value: toStorageValue(events),
  };
}

function createRunRevisionCompareAndSetItem(
  runStorageKey: string,
  currentRun: RunRecord,
): RunRevisionCompareAndSetItem {
  const value = toStorageValue(currentRun);

  return {
    key: runStorageKey,
    expected: value,
    value,
  };
}

function createRunRevisionGuardedEventHistoryCompareAndSetItems(
  runStorageKey: string,
  currentRun: RunRecord,
  eventsStorageKey: string,
  expectedEvents: StorageValue | undefined,
  events: readonly EventRecord[],
): readonly [RunRevisionCompareAndSetItem, EventHistoryCompareAndSetItem] {
  return [
    createRunRevisionCompareAndSetItem(runStorageKey, currentRun),
    createEventHistoryCompareAndSetItem(eventsStorageKey, expectedEvents, events),
  ];
}
