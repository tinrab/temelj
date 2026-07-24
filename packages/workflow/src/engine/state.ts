import type { StorageValue } from "@temelj/storage";

import type { WorkflowDefinition } from "../types/definition.ts";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { EventRecord } from "../types/events.ts";
import type { ExecutionResult } from "../types/result.ts";
import type {
  RunId,
  WorkflowAttributePatch,
  WorkflowRunRetryReason,
  WorkflowRunRecord,
  WorkflowStepIdentity,
} from "../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../types/step-attempts.ts";
import type {
  WorkflowConditionalEventAppender,
  WorkflowEventReader,
  WorkflowLockConditionalWriterRepository,
  WorkflowLockListerRepository,
  WorkflowRunConditionalWriterRepository,
  WorkflowRunReaderRepository,
  WorkflowRunUnconditionalWriterRepository,
  WorkflowRunWriterRepository,
  WorkflowStepAttemptLookup,
} from "../types/store.ts";

import { applyWorkflowAttributePatch } from "../attributes.ts";
import { WorkflowStateError } from "../errors/base.ts";
import {
  WorkflowRunCanceledError,
  WorkflowRunCancellationError,
  WorkflowRunDeadlineExceededError,
  WorkflowRunMismatchError,
} from "../errors/run.ts";
import { WorkflowHistory } from "../history/mod.ts";
import { getRequiredRun, isPositiveSafeInteger } from "../utility.ts";
import { MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS } from "./retry-policy.ts";
import { enforceWorkflowEventHistoryNextLimit } from "./retry.ts";
import { readRunResult } from "./run-utils.ts";
import { serializeError } from "./serialization.ts";

export { getRequiredRun } from "../utility.ts";

interface WorkflowEngineStateLimits {
  readonly maximumEventHistoryEvents?: number;
}

type WorkflowRunLookup = WorkflowRunReaderRepository;
type WorkflowRunWriter = WorkflowRunUnconditionalWriterRepository;
type WorkflowRunConditionalWriter = WorkflowRunConditionalWriterRepository;
type WorkflowRunStateStore = WorkflowRunLookup & WorkflowRunWriter & WorkflowRunWriterRepository;
type WorkflowCurrentEventAppender = WorkflowConditionalEventAppender;

type WorkflowLockReleaseStore = WorkflowLockListerRepository &
  WorkflowLockConditionalWriterRepository;

type WorkflowChildWakeStore = WorkflowRunStateStore &
  WorkflowEventReader &
  WorkflowStepAttemptLookup;

type WorkflowChildCascadeStore = WorkflowChildWakeStore & WorkflowLockReleaseStore;

type WorkflowChildRunStateStore = WorkflowChildCascadeStore & WorkflowCurrentEventAppender;

export function requireDefinitionMatchesRun<TInput, TOutput, TRawInput = TInput>(
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  run: WorkflowRunRecord,
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
  store: WorkflowCurrentEventAppender,
  history: WorkflowHistory,
  event: EventRecord,
  executionOwner: WorkflowRunRecord,
  limits: WorkflowEngineStateLimits,
  beforeAppend?: () => void,
  afterAppend?: (event: EventRecord, events: readonly EventRecord[]) => void,
): Promise<void> {
  let appendedEvents: readonly EventRecord[] | undefined;
  await history.append(async () => {
    beforeAppend?.();
    enforceWorkflowEventHistoryNextLimit(history.events, limits);
    const events = await store.appendEventIfRunCurrent(executionOwner, event);
    if (events === undefined) {
      WorkflowStaleExecutionError.stale(executionOwner.id);
    }
    appendedEvents = events;
    return events;
  });
  if (appendedEvents !== undefined) {
    afterAppend?.(event, appendedEvents);
  }
}

export async function requireCurrentExecutionOwner(
  store: WorkflowRunLookup,
  runId: RunId,
  executionOwner: WorkflowRunRecord,
): Promise<void> {
  const current = await store.getRun(runId);
  if (current === undefined || !isCurrentExecutionOwner(current, executionOwner)) {
    WorkflowStaleExecutionError.stale(runId);
  }
}

export async function patchRun(
  store: WorkflowRunWriter,
  current: WorkflowRunRecord,
  patch: Partial<WorkflowRunRecord>,
): Promise<WorkflowRunRecord> {
  const next: WorkflowRunRecord = {
    ...current,
    ...patch,
  };
  return await store.updateRun(next);
}

export async function patchRunIfCurrent(
  store: WorkflowRunConditionalWriter,
  current: WorkflowRunRecord,
  patch: Partial<WorkflowRunRecord>,
): Promise<WorkflowRunRecord | undefined> {
  return await store.updateRunIfCurrent(current, {
    ...current,
    ...patch,
  });
}

export async function updateRunMetadataIfCurrent(
  store: WorkflowRunLookup & WorkflowRunConditionalWriter,
  runId: RunId,
  metadata: StorageValue,
  timestamp: Temporal.Instant,
): Promise<WorkflowRunRecord> {
  for (let attempt = 0; attempt < MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS; attempt++) {
    const current = await getRequiredRun(store, runId);
    const updated = await patchRunIfCurrent(store, current, {
      metadata,
      updatedAt: timestamp,
    });
    if (updated !== undefined) {
      return updated;
    }
  }
  WorkflowStateError.failedRunMetadataUpdate(runId);
}

export async function setRunAttributesIfCurrent(
  store: WorkflowRunLookup & WorkflowRunConditionalWriter,
  runId: RunId,
  attributes: WorkflowAttributePatch,
  timestamp: Temporal.Instant,
): Promise<WorkflowRunRecord> {
  for (let attempt = 0; attempt < MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS; attempt++) {
    const current = await getRequiredRun(store, runId);
    const updated = await patchRunIfCurrent(store, current, {
      attributes: applyWorkflowAttributePatch(current.attributes, attributes),
      updatedAt: timestamp,
    });
    if (updated !== undefined) {
      return updated;
    }
  }
  WorkflowStateError.failedRunAttributesUpdate(runId);
}

export async function patchCurrentExecutionRun(
  store: WorkflowRunLookup & WorkflowRunConditionalWriter,
  executionOwner: WorkflowRunRecord,
  patch: Partial<WorkflowRunRecord>,
): Promise<WorkflowRunRecord | undefined> {
  const current = await store.getRun(executionOwner.id);
  if (current === undefined || !isCurrentExecutionOwner(current, executionOwner)) {
    return undefined;
  }
  return await patchRunIfCurrent(store, current, patch);
}

export async function patchCurrentExecutionRunAttributes(
  store: WorkflowRunLookup & WorkflowRunConditionalWriter,
  executionOwner: WorkflowRunRecord,
  attributes: WorkflowAttributePatch,
  timestamp: Temporal.Instant,
): Promise<WorkflowRunRecord | undefined> {
  const current = await store.getRun(executionOwner.id);
  if (current === undefined || !isCurrentExecutionOwner(current, executionOwner)) {
    return undefined;
  }
  return await patchRunIfCurrent(store, current, {
    attributes: applyWorkflowAttributePatch(current.attributes, attributes),
    updatedAt: timestamp,
  });
}

export function transitionRunToMissingImplementationWait(
  run: WorkflowRunRecord,
  error: WorkflowErrorRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
  retryAttempt: number,
): WorkflowRunRecord {
  return {
    ...run,
    status: "waiting",
    error,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "missing_implementation",
    availableAt,
    retryAt: availableAt,
    retryReason: "missing_implementation",
    retryAttempt,
    retryStepId: undefined,
    retryStepName: undefined,
    workerId: undefined,
    leaseExpiresAt: undefined,
    deadlineAt: run.deadlineAt,
    output: undefined,
    finishedAt: undefined,
  };
}

export function transitionRunToFailed(
  run: WorkflowRunRecord,
  error: WorkflowErrorRecord,
  timestamp: Temporal.Instant,
  lastTransitionReason: "deadline" | "failed",
  deadlineAt?: Temporal.Instant,
): WorkflowRunRecord {
  return {
    ...run,
    status: "failed",
    error,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason,
    finishedAt: timestamp,
    output: undefined,
    availableAt: undefined,
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
    workerId: undefined,
    leaseExpiresAt: undefined,
    deadlineAt: deadlineAt ?? run.deadlineAt,
  };
}

export function transitionRunToRunning(
  run: WorkflowRunRecord,
  timestamp: Temporal.Instant,
  attempts: number | undefined,
): WorkflowRunRecord {
  return {
    ...run,
    status: "running",
    attempts,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "started",
    startedAt: run.startedAt ?? timestamp,
    availableAt: undefined,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
  };
}

export function transitionRunToCompleted(
  run: WorkflowRunRecord,
  output: StorageValue | undefined,
  timestamp: Temporal.Instant,
): WorkflowRunRecord {
  return {
    ...run,
    status: "completed",
    ...(output === undefined ? { output: undefined } : { output }),
    error: undefined,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "completed",
    finishedAt: timestamp,
    availableAt: undefined,
    workerId: undefined,
    leaseExpiresAt: undefined,
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
  };
}

export function transitionRunToExecutionWait(
  run: WorkflowRunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
  options: {
    readonly retryAt?: Temporal.Instant;
    readonly retryReason?: WorkflowRunRetryReason;
    readonly retryAttempt?: number;
    readonly retryStepId?: string;
    readonly retryStepName?: string;
    readonly error?: WorkflowErrorRecord;
  } = {},
): WorkflowRunRecord {
  return {
    ...run,
    status: "waiting",
    availableAt,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: options.retryReason === undefined ? "waiting" : "retry",
    workerId: undefined,
    leaseExpiresAt: undefined,
    retryAt: options.retryAt,
    retryReason: options.retryReason,
    retryAttempt: options.retryAttempt,
    retryStepId: options.retryStepId,
    retryStepName: options.retryStepName,
    error: options.error,
    output: undefined,
    finishedAt: undefined,
  };
}

export function transitionRunToWaiting(
  run: WorkflowRunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
): WorkflowRunRecord {
  return {
    ...run,
    status: "waiting",
    availableAt,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "waiting",
    deadlineAt: run.deadlineAt,
    workerId: undefined,
    leaseExpiresAt: undefined,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
  };
}

export function transitionRunToRescheduled(
  run: WorkflowRunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
): WorkflowRunRecord {
  return {
    ...run,
    availableAt,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "rescheduled",
    deadlineAt: run.deadlineAt,
    leaseExpiresAt: undefined,
    workerId: undefined,
    retryAt: run.retryReason === undefined ? undefined : availableAt,
    retryReason: run.retryReason,
    retryAttempt: run.retryAttempt,
    retryStepId: run.retryStepId,
    retryStepName: run.retryStepName,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
  };
}

export function transitionRunAfterStaleLeaseRelease(
  run: WorkflowRunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
): WorkflowRunRecord {
  return {
    ...transitionRunToWaiting(run, timestamp, availableAt),
    lastTransitionReason: "lease_released",
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
    deadlineAt: run.deadlineAt,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
  };
}

export function transitionRunToManualRetry(
  run: WorkflowRunRecord,
  timestamp: Temporal.Instant,
  availableAt: Temporal.Instant,
  retryAttempt: number,
): WorkflowRunRecord {
  return {
    ...run,
    status: "pending",
    availableAt,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "manual_retry",
    deadlineAt: run.deadlineAt,
    workerId: undefined,
    leaseExpiresAt: undefined,
    retryAt: availableAt,
    retryReason: run.retryReason ?? "workflow",
    retryAttempt,
    retryStepId: run.retryStepId,
    retryStepName: run.retryStepName,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
  };
}

export function transitionRunToPermanentFailure(
  run: WorkflowRunRecord,
  error: WorkflowErrorRecord,
  timestamp: Temporal.Instant,
): WorkflowRunRecord {
  return {
    ...run,
    status: "failed",
    error,
    output: undefined,
    availableAt: undefined,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "permanent_failure",
    deadlineAt: run.deadlineAt,
    workerId: undefined,
    leaseExpiresAt: undefined,
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
    finishedAt: timestamp,
  };
}

export function transitionRunToCanceled(
  run: WorkflowRunRecord,
  error: WorkflowErrorRecord,
  timestamp: Temporal.Instant,
): WorkflowRunRecord {
  return {
    ...run,
    status: "canceled",
    error,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "canceled",
    finishedAt: timestamp,
    availableAt: undefined,
    output: undefined,
    workerId: undefined,
    leaseExpiresAt: undefined,
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
  };
}

export function transitionRunAfterParentWake(
  run: WorkflowRunRecord,
  timestamp: Temporal.Instant,
): WorkflowRunRecord {
  return {
    ...run,
    availableAt: timestamp,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "waiting",
    deadlineAt: run.deadlineAt,
    retryAt: run.retryAt,
    startedAt: run.startedAt ?? timestamp,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
  };
}

export function isCurrentExecutionOwner(
  current: WorkflowRunRecord,
  execution: WorkflowRunRecord,
): boolean {
  // Worker ownership is the pair of workerId and execution attempt.
  // A stale worker with the same run id must not append events or patch state after another worker has reclaimed the run.
  return (
    current.status === "running" &&
    current.workerId === execution.workerId &&
    current.attempts === execution.attempts
  );
}

export async function cancelRunWithChildren(
  store: WorkflowChildCascadeStore,
  runId: RunId,
  canceledAt: Temporal.Instant,
): Promise<WorkflowRunRecord> {
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
    transitionRunToCanceled(
      run,
      serializeError(WorkflowRunCanceledError.create(runId)),
      canceledAt,
    ),
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
  await wakeParentRunForTerminalChild(store, canceledRun, canceledAt);
  return canceledRun;
}

export async function cancelActiveChildRuns(
  store: WorkflowChildCascadeStore,
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

export async function wakeParentRunForTerminalChild(
  store: WorkflowChildWakeStore,
  childRun: WorkflowRunRecord,
  timestamp: Temporal.Instant,
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

  const wakeAt = timestamp;
  if (
    parentRun.availableAt !== undefined &&
    Temporal.Instant.compare(parentRun.availableAt, wakeAt) <= 0
  ) {
    return;
  }

  await patchRun(store, parentRun, transitionRunAfterParentWake(parentRun, timestamp));
}

export async function wakeParentRunForWaitingChild(
  store: WorkflowChildWakeStore,
  childRun: WorkflowRunRecord,
  availableAt: Temporal.Instant,
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

  const wakeAt = availableAt;
  if (
    parentRun.availableAt !== undefined &&
    Temporal.Instant.compare(parentRun.availableAt, wakeAt) <= 0
  ) {
    return;
  }

  await patchRun(store, parentRun, transitionRunAfterParentWake(parentRun, availableAt));
}

export async function parentHasActiveChildWorkflowAttemptForRun(
  store: WorkflowChildWakeStore,
  parentRunId: RunId,
  childRun: WorkflowRunRecord,
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

export async function parentHasActiveChildWorkflowEventForAttempt(
  store: WorkflowEventReader,
  parentRunId: RunId,
  attempt: WorkflowStepAttemptRecord,
): Promise<boolean> {
  if (attempt.childRunId === undefined) {
    return false;
  }
  const events = await store.getEvents(parentRunId);
  const lifecycle = new WorkflowHistory(events).childWorkflowLifecycleForAttempt(attempt);
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
  store: WorkflowChildRunStateStore,
  run: WorkflowRunRecord,
  deadlineAt: Temporal.Instant,
  failedAt: Temporal.Instant,
  executionOwner?: WorkflowRunRecord,
): Promise<ExecutionResult<TOutput>> {
  const serialized = serializeError(WorkflowRunDeadlineExceededError.create(run.id, deadlineAt));
  if (executionOwner !== undefined) {
    const current = await store.getRun(run.id);
    if (current === undefined || !isCurrentExecutionOwner(current, executionOwner)) {
      return await readRunResult<TOutput>(store, run.id, failedAt);
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
    return await readRunResult<TOutput>(store, run.id, failedAt);
  }
  const failedEvents = await store.appendEventIfRunCurrent(failedRun, {
    kind: "workflow_failed",
    timestamp: failedAt,
  });
  if (failedEvents === undefined) {
    return await readRunResult<TOutput>(store, run.id, failedAt);
  }
  await releaseLocksForRun(store, run.id, failedAt);
  await wakeParentRunForTerminalChild(store, failedRun, failedAt);
  return {
    kind: "failed",
    run: failedRun,
    error: serialized,
  };
}

export async function releaseLocksForRun(
  store: WorkflowLockReleaseStore,
  runId: RunId,
  releasedAt: Temporal.Instant,
): Promise<void> {
  const timestamp = releasedAt;
  const locks = await store.listLocks();
  await Promise.all(
    locks
      .filter((lock) => lock.releasedAt === undefined && lock.holderRunId === runId)
      .map(async (lock) => {
        await store.updateLockIfCurrent(lock, {
          ...lock,
          releasedAt: timestamp,
        });
      }),
  );
}

export class WorkflowSuspended extends Error {
  public readonly availableAt: Temporal.Instant;
  public readonly retryAt?: Temporal.Instant;
  public readonly retryReason?: "step";
  public readonly retryAttempt?: number;
  public readonly retryStep?: WorkflowStepIdentity;

  constructor(availableAt: Temporal.Instant, context?: Function) {
    super(`Workflow suspended until ${availableAt.toString()}`);
    this.name = "WorkflowSuspended";
    this.availableAt = availableAt;
    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static until(this: void, availableAt: Temporal.Instant): never {
    throw new WorkflowSuspended(availableAt, WorkflowSuspended.until);
  }

  static forStepRetry(
    this: void,
    retryAt: Temporal.Instant,
    retryStep: WorkflowStepIdentity,
    retryAttempt: number,
  ): never {
    const suspended = new WorkflowSuspended(retryAt, WorkflowSuspended.forStepRetry);
    Object.defineProperties(suspended, {
      retryAt: { value: retryAt, enumerable: true },
      retryReason: { value: "step", enumerable: true },
      retryAttempt: { value: retryAttempt, enumerable: true },
      retryStep: { value: retryStep, enumerable: true },
    });
    throw suspended;
  }
}

export class WorkflowStaleExecutionError extends Error {
  constructor(runId: RunId, context?: Function) {
    super(`Workflow execution no longer owns run: ${runId}`);
    this.name = "WorkflowStaleExecutionError";
    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static stale(this: void, runId: RunId): never {
    throw new WorkflowStaleExecutionError(runId, WorkflowStaleExecutionError.stale);
  }
}
