import type { StorageCompareAndSetManyItem, StorageValue } from "@temelj/storage";

import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { MaterializedStepType } from "../types/run.ts";
import type { StepAttemptRecord } from "../types/step-attempts.ts";
import type { WorkflowStorage } from "../types/store.ts";

import { omitUndefined } from "../collection.ts";
import { WorkflowStateError } from "../errors/base.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { getWorkflowEventStepAttemptKey } from "../events/descriptors.ts";
import { applyStepAttemptEvent } from "../history/replay.ts";
import { createStepAttempts } from "../history/step-attempts.ts";
import { makeStepAttemptKey, stepAttemptKey } from "../store-keys.ts";
import { supportsConditionalWrite } from "./capabilities.ts";
import { rollbackAppendedEventIfCurrent } from "./events.ts";
import { requireReadableStoredRun } from "./run.ts";
import { toStorageValue } from "./storage-value.ts";
import { parseStoredStepAttemptRecord } from "./validation.ts";

const MAX_MATERIALIZE_STEP_ATTEMPT_ATTEMPTS = 16;

type MaterializedStepAttemptField = keyof StepAttemptRecord;

type MaterializedStepDescriptor = {
  readonly identityFields: readonly MaterializedStepAttemptField[];
};

interface StepAttemptMaterializationUpdate {
  readonly storageKey: string;
  readonly next?: StepAttemptRecord;
  readonly shouldStore: boolean;
}

export interface StepAttemptMaterializationStoragePlan {
  readonly materializes: boolean;
  readonly storageKey?: string;
  readonly current?: StepAttemptRecord;
  readonly item?: StorageCompareAndSetManyItem<StorageValue>;
}

interface StepAttemptAppendMaterializationOutcome {
  readonly status: "appended" | "duplicate";
  readonly events: readonly EventRecord[];
  readonly previousEventHistory?: StorageValue;
}

interface StoredStepAttempt {
  readonly raw: StorageValue | undefined;
  readonly current: StepAttemptRecord | undefined;
}

// Defines the fields that make each materialized step attempt distinct.
// Materialization uses this when deciding whether an incoming terminal attempt updates the current read-model row or represents a different logical sleep, child workflow, message send, or message wait.
const WORKFLOW_MATERIALIZED_STEP_DESCRIPTORS = {
  run: {
    identityFields: [],
  },
  sleep: {
    identityFields: ["until"],
  },
  workflow: {
    identityFields: ["childRunId", "workflowName", "workflowVersion", "cancellation"],
  },
  "message-send": {
    identityFields: ["targetRunId", "messageId"],
  },
  "message-wait": {
    identityFields: ["messageId"],
  },
  stream: {
    identityFields: [],
  },
  deterministic: {
    identityFields: [],
  },
} satisfies {
  readonly [Kind in MaterializedStepType]: MaterializedStepDescriptor;
};

async function materializeStepAttempt(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
): Promise<void> {
  const storageKey = getStepAttemptMaterializationStorageKey(namespace, runId, event);

  if (storageKey === undefined) {
    return;
  }

  await materializeStepAttemptIfCurrent(storage, runId, storageKey, (current) =>
    applyStepAttemptEvent(runId, event, current),
  );
}

export async function materializeStepAttemptForAppendOutcome(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  outcome: StepAttemptAppendMaterializationOutcome,
): Promise<void> {
  try {
    await materializeStepAttempt(storage, namespace, runId, event);
  } catch (error) {
    // Event history and the materialized attempt are ideally committed together.
    // Backends without multi-key CAS get a best-effort rollback to avoid a durable event without its read-model update.
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
}

function getStepAttemptMaterializationStorageKey(
  namespace: string,
  runId: RunId,
  event: EventRecord,
): string | undefined {
  let attemptKey: string | undefined;

  try {
    attemptKey = getWorkflowEventStepAttemptKey(event);
  } catch {
    attemptKey = undefined;
  }

  return attemptKey === undefined ? undefined : makeStepAttemptKey(namespace, runId, attemptKey);
}

function createStepAttemptMaterializationUpdate(
  namespace: string,
  runId: RunId,
  event: EventRecord,
  current: StepAttemptRecord | undefined,
): StepAttemptMaterializationUpdate | undefined {
  const storageKey = getStepAttemptMaterializationStorageKey(namespace, runId, event);

  if (storageKey === undefined) {
    return undefined;
  }

  const next = applyStepAttemptEvent(runId, event, current);

  return {
    storageKey,
    next,
    shouldStore: next !== undefined && shouldStoreStepAttempt(current, next),
  };
}

export async function createStepAttemptMaterializationStoragePlan(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
): Promise<StepAttemptMaterializationStoragePlan> {
  const storageKey = getStepAttemptMaterializationStorageKey(namespace, runId, event);

  if (storageKey === undefined) {
    return { materializes: false };
  }

  const { raw, current } = await readStoredStepAttempt(storage, storageKey);

  const materialization = createStepAttemptMaterializationUpdate(namespace, runId, event, current);

  return {
    materializes: true,
    storageKey,
    current,
    item:
      materialization?.shouldStore === true && materialization.next !== undefined
        ? {
            key: materialization.storageKey,
            expected: raw,
            value: toStorageValue(omitUndefined(materialization.next)),
          }
        : undefined,
  };
}

export async function reconcileStepAttempts(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  events: readonly EventRecord[],
): Promise<readonly StepAttemptRecord[]> {
  const attempts = createStepAttempts(runId, events);
  await requireReadableStoredRun(storage, namespace, runId);
  await Promise.all(
    attempts.map((attempt) =>
      materializeStepAttemptIfCurrent(
        storage,
        runId,
        makeStepAttemptKey(namespace, runId, stepAttemptKey(attempt.stepId, attempt.attempt)),
        () => attempt,
        { repairStatusMismatch: true },
      ),
    ),
  );

  return attempts;
}

async function materializeStepAttemptIfCurrent(
  storage: WorkflowStorage,
  runId: RunId,
  storageKey: string,
  createNext: (current: StepAttemptRecord | undefined) => StepAttemptRecord | undefined,
  options: { readonly repairStatusMismatch?: boolean } = {},
): Promise<void> {
  if (!supportsConditionalWrite(storage)) {
    // Stores without CAS can still maintain the read model, but concurrent writers may race.
    // The CAS path below is used whenever the storage backend can reject stale writes.
    const { current } = await readStoredStepAttempt(storage, storageKey);
    const next = createNext(current);

    if (next !== undefined && shouldStoreStepAttempt(current, next, options)) {
      await storage.set(storageKey, toStorageValue(omitUndefined(next)));
    }

    return;
  }

  for (let attempt = 0; attempt < MAX_MATERIALIZE_STEP_ATTEMPT_ATTEMPTS; attempt++) {
    const { raw, current } = await readStoredStepAttempt(storage, storageKey);
    const next = createNext(current);

    if (next === undefined || !shouldStoreStepAttempt(current, next, options)) {
      return;
    }

    const updated = await storage.compareAndSet(
      storageKey,
      raw,
      toStorageValue(omitUndefined(next)),
    );

    if (updated) {
      return;
    }
  }

  throw new WorkflowStateError(
    `Failed to materialize workflow step attempt for run ${runId} after ${MAX_MATERIALIZE_STEP_ATTEMPT_ATTEMPTS} attempts`,
    {
      code: WorkflowErrorCode.STATE_STEP_ATTEMPT_MATERIALIZATION_FAILED,
      details: { runId: runId, attempts: MAX_MATERIALIZE_STEP_ATTEMPT_ATTEMPTS },
    },
  );
}

async function readStoredStepAttempt(
  storage: WorkflowStorage,
  storageKey: string,
): Promise<StoredStepAttempt> {
  const raw = await storage.get(storageKey);

  return {
    raw,
    current: parseStoredStepAttemptRecord(raw),
  };
}

function shouldStoreStepAttempt(
  current: StepAttemptRecord | undefined,
  next: StepAttemptRecord,
  options: { readonly repairStatusMismatch?: boolean } = {},
): boolean {
  if (current === undefined) {
    return true;
  }

  if (!isSameStepAttemptIdentity(current, next)) {
    return true;
  }

  if ((current.status === "abandoned") !== (next.status === "abandoned")) {
    return true;
  }

  if (options.repairStatusMismatch === true && current.status !== next.status) {
    return true;
  }

  // Started/finished timestamps are the monotonic version for materialized attempts.
  // When two events have the same timestamp, terminal states win over running so a completion is not lost.
  const currentTimestamp = current.finishedAt ?? current.startedAt;
  const nextTimestamp = next.finishedAt ?? next.startedAt;

  if (currentTimestamp === undefined) {
    return true;
  }

  if (nextTimestamp === undefined) {
    return false;
  }

  if (Temporal.Instant.compare(currentTimestamp, nextTimestamp) > 0) {
    return false;
  }

  if (Temporal.Instant.compare(currentTimestamp, nextTimestamp) < 0) {
    return true;
  }

  const nextRank =
    next.status === "running"
      ? 0
      : next.status === "abandoned" || next.status === "failed" || next.status === "completed"
        ? 1
        : 0;

  const currentRank =
    current.status === "running"
      ? 0
      : current.status === "abandoned" ||
          current.status === "failed" ||
          current.status === "completed"
        ? 1
        : 0;

  return nextRank >= currentRank;
}

export function isSameStepAttemptIdentity(
  current: StepAttemptRecord,
  next: StepAttemptRecord,
): boolean {
  if (
    !(
      current.runId === next.runId &&
      current.stepId === next.stepId &&
      current.stepName === next.stepName &&
      current.kind === next.kind &&
      current.attempt === next.attempt &&
      current.count === next.count
    )
  ) {
    return false;
  }

  return isSameMaterializedStepAttemptFields(
    current,
    next,
    WORKFLOW_MATERIALIZED_STEP_DESCRIPTORS[current.kind].identityFields,
  );
}

function isSameMaterializedStepAttemptFields(
  current: StepAttemptRecord,
  next: StepAttemptRecord,
  fields: readonly MaterializedStepAttemptField[],
): boolean {
  return fields.every((field) => current[field] === next[field]);
}
