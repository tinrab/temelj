import type { StorageValue } from "@temelj/storage";

import type { WorkflowDefinition } from "../types/definition.ts";
import type { ExecutionLimits } from "../types/engine-options.ts";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { ExecutionResult } from "../types/result.ts";
import type {
  AttributePatch,
  RunRecord,
  RunRetryReason,
  RunTransitionReason,
  TerminalRunStatus,
} from "../types/run.ts";
import type { StepAttemptRecord } from "../types/step-attempts.ts";
import type { WorkflowStore } from "../types/store.ts";

import { applyAttributePatch } from "../attributes.ts";
import { WorkflowStateError } from "../errors/base.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import {
  WorkflowRunCanceledError,
  WorkflowRunCancellationError,
  WorkflowRunDeadlineExceededError,
  WorkflowRunMismatchError,
} from "../errors/run.ts";
import { History } from "../history/replay.ts";
import { CLEARED_LEASE, CLEARED_RETRY, UNFINISHED } from "../run-status.ts";
import { getRequiredRun } from "../store/query.ts";
import { isPositiveSafeInteger } from "../values.ts";
import { enforceEventHistoryNextLimit } from "./retry.ts";
import { readRunResult } from "./run-utils.ts";
import { serializeError } from "./serialization.ts";
import { StaleExecutionError } from "./signals.ts";

// Run updates retry bounded optimistic conflicts, so a hot run cannot monopolize a worker.
export const MAX_RUN_UPDATE_ATTEMPTS = 16;

export function requireDefinitionMatchesRun<TInput, TOutput, TRawInput = TInput>(
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  run: RunRecord,
): void {
  if (definition.name !== run.workflowName) {
    WorkflowRunMismatchError.mismatch({
      runId: run.id,
      expectedWorkflowName: definition.name,
      actualWorkflowName: run.workflowName,
    });
  }

  if (definition.version !== run.workflowVersion) {
    WorkflowRunMismatchError.mismatch({
      runId: run.id,
      expectedWorkflowName:
        definition.version === undefined
          ? definition.name
          : `${definition.name}@${definition.version}`,
      actualWorkflowName:
        run.workflowVersion === undefined
          ? run.workflowName
          : `${run.workflowName}@${run.workflowVersion}`,
    });
  }
}

export async function appendEventIfCurrentExecution(
  store: WorkflowStore,
  history: History,
  event: EventRecord,
  executionOwner: RunRecord,
  limits: ExecutionLimits,
  beforeAppend?: () => void,
  afterAppend?: (event: EventRecord, events: readonly EventRecord[]) => void,
): Promise<void> {
  let appendedEvents: readonly EventRecord[] | undefined;
  await history.append(async () => {
    beforeAppend?.();
    enforceEventHistoryNextLimit(history.events, limits);

    for (let attempt = 0; attempt < MAX_RUN_UPDATE_ATTEMPTS; attempt++) {
      const current = await store.getRun(executionOwner.id);

      if (current === undefined || !isCurrentExecutionOwner(current, executionOwner)) {
        StaleExecutionError.stale(executionOwner.id);
      }

      const events = await store.appendEventIfRunCurrent(current, event);

      if (events !== undefined) {
        appendedEvents = events;

        return events;
      }
    }

    StaleExecutionError.stale(executionOwner.id);
  });

  if (appendedEvents !== undefined) {
    afterAppend?.(event, appendedEvents);
  }
}

export async function requireCurrentExecutionOwner(
  store: WorkflowStore,
  executionOwner: RunRecord,
): Promise<void> {
  if ((await currentExecution(store, executionOwner)) === undefined) {
    StaleExecutionError.stale(executionOwner.id);
  }
}

/** The stored run, while `executionOwner` still holds its lease; otherwise `undefined`. */
async function currentExecution(
  store: WorkflowStore,
  executionOwner: RunRecord,
): Promise<RunRecord | undefined> {
  const current = await store.getRun(executionOwner.id);

  return current !== undefined && isCurrentExecutionOwner(current, executionOwner)
    ? current
    : undefined;
}

export async function patchRun(
  store: WorkflowStore,
  current: RunRecord,
  patch: Partial<RunRecord>,
): Promise<RunRecord> {
  const next: RunRecord = {
    ...current,
    ...patch,
  };

  return await store.updateRun(next);
}

export async function patchRunIfCurrent(
  store: WorkflowStore,
  current: RunRecord,
  patch: Partial<RunRecord>,
): Promise<RunRecord | undefined> {
  return await store.updateRunIfCurrent(current, {
    ...current,
    ...patch,
  });
}

export async function updateRunMetadataIfCurrent(
  store: WorkflowStore,
  runId: RunId,
  metadata: StorageValue,
  timestamp: Temporal.Instant,
): Promise<RunRecord> {
  return await patchRunWithRetry(
    store,
    runId,
    () => ({ metadata, updatedAt: timestamp }),
    `Failed to update workflow run metadata for run ${runId}`,
    WorkflowErrorCode.STATE_RUN_METADATA_UPDATE_FAILED,
  );
}

export async function setRunAttributesIfCurrent(
  store: WorkflowStore,
  runId: RunId,
  attributes: AttributePatch,
  timestamp: Temporal.Instant,
): Promise<RunRecord> {
  return await patchRunWithRetry(
    store,
    runId,
    (current) => attributesPatch(current, attributes, timestamp),
    `Failed to update workflow run attributes for run ${runId}`,
    WorkflowErrorCode.STATE_RUN_ATTRIBUTES_UPDATE_FAILED,
  );
}

/** Patches a run, retrying when another writer updates the run first. */
async function patchRunWithRetry(
  store: WorkflowStore,
  runId: RunId,
  patch: (current: RunRecord) => Partial<RunRecord>,
  failureMessage: string,
  failureCode: WorkflowErrorCode,
): Promise<RunRecord> {
  for (let attempt = 0; attempt < MAX_RUN_UPDATE_ATTEMPTS; attempt++) {
    const current = await getRequiredRun(store, runId);
    const updated = await patchRunIfCurrent(store, current, patch(current));

    if (updated !== undefined) {
      return updated;
    }
  }

  throw new WorkflowStateError(failureMessage, { code: failureCode, details: { runId } });
}

function attributesPatch(
  current: RunRecord,
  attributes: AttributePatch,
  timestamp: Temporal.Instant,
): Partial<RunRecord> {
  return { attributes: applyAttributePatch(current.attributes, attributes), updatedAt: timestamp };
}

export async function patchCurrentExecutionRun(
  store: WorkflowStore,
  executionOwner: RunRecord,
  patch: Partial<RunRecord>,
): Promise<RunRecord | undefined> {
  const current = await currentExecution(store, executionOwner);

  if (current === undefined) {
    return undefined;
  }

  return await patchRunIfCurrent(store, current, patch);
}

export async function patchCurrentExecutionRunAttributes(
  store: WorkflowStore,
  executionOwner: RunRecord,
  attributes: AttributePatch,
  timestamp: Temporal.Instant,
): Promise<RunRecord | undefined> {
  const current = await currentExecution(store, executionOwner);

  if (current === undefined) {
    return undefined;
  }

  return await patchRunIfCurrent(store, current, attributesPatch(current, attributes, timestamp));
}

/** The run with the transition stamped on it; every transition starts here. */
function moved(
  run: RunRecord,
  timestamp: Temporal.Instant,
  reason: RunTransitionReason,
): RunRecord {
  return {
    ...run,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: reason,
  };
}

/** A terminal run: no lease, no retry, nothing left to schedule. */
function finished(
  run: RunRecord,
  timestamp: Temporal.Instant,
  status: TerminalRunStatus,
  reason: RunTransitionReason,
  result: { readonly output?: StorageValue; readonly error?: WorkflowErrorRecord },
): RunRecord {
  return {
    ...moved(run, timestamp, reason),
    status,
    output: result.output,
    error: result.error,
    finishedAt: timestamp,
    availableAt: undefined,
    ...CLEARED_LEASE,
    ...CLEARED_RETRY,
  };
}

export function transitionRunToRunning(
  run: RunRecord,
  timestamp: Temporal.Instant,
  attempts: number | undefined,
): RunRecord {
  return {
    ...moved(run, timestamp, "started"),
    ...UNFINISHED,
    ...CLEARED_RETRY,
    status: "running",
    attempts,
    startedAt: run.startedAt ?? timestamp,
    availableAt: undefined,
  };
}

export function transitionRunToCompleted(
  run: RunRecord,
  output: StorageValue | undefined,
  timestamp: Temporal.Instant,
): RunRecord {
  return finished(run, timestamp, "completed", "completed", { output });
}

export function transitionRunToFailed(
  run: RunRecord,
  error: WorkflowErrorRecord,
  timestamp: Temporal.Instant,
  reason: "deadline" | "failed" | "permanent_failure",
  deadlineAt?: Temporal.Instant,
): RunRecord {
  return {
    ...finished(run, timestamp, "failed", reason, { error }),
    deadlineAt: deadlineAt ?? run.deadlineAt,
  };
}

export function transitionRunToCanceled(
  run: RunRecord,
  error: WorkflowErrorRecord,
  timestamp: Temporal.Instant,
): RunRecord {
  return finished(run, timestamp, "canceled", "canceled", { error });
}

export function transitionRunToWaiting(
  run: RunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
): RunRecord {
  return {
    ...moved(run, timestamp, "waiting"),
    ...UNFINISHED,
    ...CLEARED_LEASE,
    status: "waiting",
    availableAt,
  };
}

/** Waits after an execution suspended, optionally to retry a failed step or workflow. */
export function transitionRunToExecutionWait(
  run: RunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
  options: {
    readonly retryAt?: Temporal.Instant;
    readonly retryReason?: RunRetryReason;
    readonly retryAttempt?: number;
    readonly retryStepId?: string;
    readonly retryStepName?: string;
    readonly error?: WorkflowErrorRecord;
  } = {},
): RunRecord {
  return {
    ...transitionRunToWaiting(run, timestamp, availableAt),
    lastTransitionReason: options.retryReason === undefined ? "waiting" : "retry",
    retryAt: options.retryAt,
    retryReason: options.retryReason,
    retryAttempt: options.retryAttempt,
    retryStepId: options.retryStepId,
    retryStepName: options.retryStepName,
    error: options.error,
  };
}

export function transitionRunToMissingImplementationWait(
  run: RunRecord,
  error: WorkflowErrorRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
  retryAttempt: number,
): RunRecord {
  return {
    ...transitionRunToWaiting(run, timestamp, availableAt),
    ...CLEARED_RETRY,
    lastTransitionReason: "missing_implementation",
    retryAt: availableAt,
    retryReason: "missing_implementation",
    retryAttempt,
    error,
  };
}

export function transitionRunAfterStaleLeaseRelease(
  run: RunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
): RunRecord {
  return {
    ...transitionRunToWaiting(run, timestamp, availableAt),
    ...CLEARED_RETRY,
    lastTransitionReason: "lease_released",
  };
}

/** Moves the run's next attempt to `availableAt`, keeping its status and retry details. */
export function transitionRunToRescheduled(
  run: RunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
): RunRecord {
  return {
    ...moved(run, timestamp, "rescheduled"),
    ...UNFINISHED,
    ...CLEARED_LEASE,
    availableAt,
    retryAt: run.retryReason === undefined ? undefined : availableAt,
  };
}

export function transitionRunToManualRetry(
  run: RunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
  retryAttempt: number,
): RunRecord {
  return {
    ...moved(run, timestamp, "manual_retry"),
    ...UNFINISHED,
    ...CLEARED_LEASE,
    status: "pending",
    availableAt,
    retryAt: availableAt,
    retryReason: run.retryReason ?? "workflow",
    retryAttempt,
  };
}

function transitionRunAfterParentWake(run: RunRecord, timestamp: Temporal.Instant): RunRecord {
  return {
    ...moved(run, timestamp, "waiting"),
    ...UNFINISHED,
    availableAt: timestamp,
    startedAt: run.startedAt ?? timestamp,
  };
}

export function isCurrentExecutionOwner(current: RunRecord, execution: RunRecord): boolean {
  // Worker ownership is the pair of workerId and execution attempt.
  // A stale worker with the same run id must not append events or patch state after another worker has reclaimed the run.
  return (
    current.status === "running" &&
    current.workerId === execution.workerId &&
    current.attempts === execution.attempts
  );
}

export async function cancelRunWithChildren(
  store: WorkflowStore,
  runId: RunId,
  canceledAt: Temporal.Instant,
): Promise<RunRecord> {
  const run = await getRequiredRun(store, runId);

  if (run.status === "completed" || run.status === "failed") {
    WorkflowRunCancellationError.cannotCancel(runId, run.status);
  }

  if (run.status === "canceled") {
    return run;
  }

  const canceledRun = await patchRunIfCurrent(
    store,
    run,
    transitionRunToCanceled(run, serializeError(new WorkflowRunCanceledError(runId)), canceledAt),
  );

  if (canceledRun === undefined) {
    const latest = await getRequiredRun(store, runId);

    if (latest.status === "completed" || latest.status === "failed") {
      WorkflowRunCancellationError.cannotCancel(runId, latest.status);
    }

    if (latest.status === "canceled") {
      return latest;
    }

    return await cancelRunWithChildren(store, runId, canceledAt);
  }

  await releaseLocksForRun(store, run.id, canceledAt);
  await cancelActiveChildRuns(store, run.id, canceledAt);
  await wakeParentRun(store, canceledRun, canceledAt);

  return canceledRun;
}

async function cancelActiveChildRuns(
  store: WorkflowStore,
  parentRunId: RunId,
  canceledAt: Temporal.Instant,
): Promise<void> {
  const attempts = await store.listStepAttempts(parentRunId, {
    kind: "workflow",
    status: "running",
  });

  const childRunIds = new Set<string>();

  for (const attempt of attempts) {
    if (
      attempt.childRunId !== undefined &&
      (attempt.cancellation ?? "cascade") === "cascade" &&
      (await parentHasActiveChildWorkflowEventForAttempt(store, parentRunId, attempt))
    ) {
      childRunIds.add(attempt.childRunId);
    }
  }

  for (const childRunId of childRunIds) {
    const child = await store.getRun(childRunId);

    if (child === undefined) {
      continue;
    }

    if (!(await parentHasActiveChildWorkflowAttemptForRun(store, parentRunId, child))) {
      continue;
    }

    if (child.status === "completed" || child.status === "failed" || child.status === "canceled") {
      continue;
    }

    await cancelRunWithChildren(store, child.id, canceledAt);
  }
}

/** Makes a waiting parent run available by `at` when one of its child workflow steps changes. */
export async function wakeParentRun(
  store: WorkflowStore,
  childRun: RunRecord,
  at: Temporal.Instant,
): Promise<void> {
  if (childRun.parentRunId === undefined) {
    return;
  }

  const parentRun = await store.getRun(childRun.parentRunId);

  if (parentRun === undefined || parentRun.status !== "waiting") {
    return;
  }

  if (!(await parentHasActiveChildWorkflowAttemptForRun(store, parentRun.id, childRun))) {
    return;
  }

  if (
    parentRun.availableAt !== undefined &&
    Temporal.Instant.compare(parentRun.availableAt, at) <= 0
  ) {
    return;
  }

  await patchRun(store, parentRun, transitionRunAfterParentWake(parentRun, at));
}

async function parentHasActiveChildWorkflowAttemptForRun(
  store: WorkflowStore,
  parentRunId: RunId,
  childRun: RunRecord,
): Promise<boolean> {
  if (childRun.parentRunId !== parentRunId) {
    return false;
  }

  const attempts = await store.listStepAttempts(parentRunId, {
    kind: "workflow",
    status: "running",
    childRunId: childRun.id,
  });

  for (const attempt of attempts) {
    if (
      childRun.parentRunId === parentRunId &&
      childRun.parentStepId === attempt.stepId &&
      childRun.parentStepName === attempt.stepName &&
      childRun.parentStepAttempt === attempt.attempt &&
      attempt.childRunId === childRun.id &&
      attempt.workflowName === childRun.workflowName &&
      attempt.workflowVersion === childRun.workflowVersion &&
      (await parentHasActiveChildWorkflowEventForAttempt(store, parentRunId, attempt))
    ) {
      return true;
    }
  }

  return false;
}

async function parentHasActiveChildWorkflowEventForAttempt(
  store: WorkflowStore,
  parentRunId: RunId,
  attempt: StepAttemptRecord,
): Promise<boolean> {
  if (attempt.childRunId === undefined) {
    return false;
  }

  const events = await store.getEvents(parentRunId);
  const lifecycle = new History(events).childWorkflowLifecycleForAttempt(attempt);

  if (lifecycle.started === undefined) {
    return false;
  }

  if (!isPositiveSafeInteger(lifecycle.started.attempt)) {
    return false;
  }

  // The materialized attempt may still exist after the child has completed.
  // The event history is checked here to confirm that the parent is still actively waiting for this exact child.
  return !lifecycle.hasTerminalAfterStarted;
}

export async function failRunForDeadline<TOutput>(
  store: WorkflowStore,
  definition: WorkflowDefinition<unknown, TOutput, unknown>,
  run: RunRecord,
  deadlineAt: Temporal.Instant,
  failedAt: Temporal.Instant,
  executionOwner?: RunRecord,
): Promise<ExecutionResult<TOutput>> {
  const serialized = serializeError(new WorkflowRunDeadlineExceededError(run.id, deadlineAt));

  if (executionOwner !== undefined) {
    const current = await store.getRun(run.id);

    if (current === undefined || !isCurrentExecutionOwner(current, executionOwner)) {
      return await readRunResult(store, definition, run.id, failedAt);
    }
  }

  await cancelActiveChildRuns(store, run.id, failedAt);

  const failedRun =
    executionOwner === undefined
      ? await patchRun(store, run, transitionRunToFailed(run, serialized, failedAt, "deadline"))
      : await patchCurrentExecutionRun(
          store,
          executionOwner,
          transitionRunToFailed(executionOwner, serialized, failedAt, "deadline"),
        );

  if (failedRun === undefined) {
    return await readRunResult(store, definition, run.id, failedAt);
  }

  const failedEvents = await store.appendEventIfRunCurrent(failedRun, {
    kind: "workflow_failed",
    timestamp: failedAt,
  });

  if (failedEvents === undefined) {
    return await readRunResult(store, definition, run.id, failedAt);
  }

  await releaseLocksForRun(store, run.id, failedAt);
  await wakeParentRun(store, failedRun, failedAt);

  return {
    kind: "failed",
    run: failedRun,
    error: serialized,
  };
}

export async function releaseLocksForRun(
  store: WorkflowStore,
  runId: RunId,
  releasedAt: Temporal.Instant,
): Promise<void> {
  const locks = await store.listLocks();
  await Promise.all(
    locks
      .filter((lock) => lock.releasedAt === undefined && lock.holderRunId === runId)
      .map(async (lock) => {
        await store.updateLockIfCurrent(lock, {
          ...lock,
          releasedAt: releasedAt,
        });
      }),
  );
}
