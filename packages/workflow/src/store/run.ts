import type { EventRecord } from "../types/events.ts";
import type { WorkflowPage } from "../types/pagination.ts";
import type { WorkflowListRunsOptions, WorkflowListRunsPageOptions } from "../types/run-list.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowClaimRunOptions, WorkflowStorage } from "../types/store.ts";

import { omitUndefined } from "../collection.ts";
import { WorkflowStateError } from "../errors/mod.ts";
import { WorkflowRunNotFoundError } from "../errors/run.ts";
import { makeWorkflowRunCursorKey, pageItems } from "../pagination.ts";
import { makeRunKey } from "../store-keys.ts";
import { WorkerId } from "../types/worker-id.ts";
import {
  isTerminalWorkflowLifecycleEventForRun,
  isTerminalWorkflowRunStatus,
  limitWorkflowItems,
  nextRunAttempt,
} from "../utility.ts";
import { supportsWorkflowConditionalWrite } from "./capabilities.ts";
import { compactWorkflowStoreRecord } from "./compaction.ts";
import { rollbackAppendedEventIfCurrent } from "./event-history.ts";
import { matchesWorkflowRunListOptions } from "./query.ts";
import { queryWorkflowRuns } from "./query.ts";
import { isSameWorkflowStorageValue } from "./revision.ts";
import { toStorageValue } from "./storage-value.ts";
import {
  isReadableWorkflowRunRecord,
  parseStoredWorkflowRunRecord,
  requireReadableStoreRun,
  requireValidRunTransition,
} from "./validation.ts";

interface WorkflowRunReader {
  getRun(runId: RunId): Promise<WorkflowRunRecord | undefined>;
}

interface WorkflowRunClaimReader extends WorkflowRunReader {
  listRuns(options?: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]>;
}

export async function updateRunIfCurrent(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowRunReader,
  current: WorkflowRunRecord,
  next: WorkflowRunRecord,
): Promise<WorkflowRunRecord | undefined> {
  const runId = current.id;
  const nextRunId = next.id;
  if (runId !== nextRunId) {
    WorkflowStateError.runIdMismatch(runId, nextRunId);
  }

  requireReadableStoreRun(current, namespace);

  if (next.namespace !== namespace) {
    WorkflowStateError.runNamespaceMismatch(String(next.namespace), namespace);
  }

  if (!supportsWorkflowConditionalWrite(storage)) {
    const latest = await store.getRun(runId);
    if (
      latest === undefined ||
      !isSameWorkflowStorageValue(omitUndefined(latest), omitUndefined(current))
    ) {
      return undefined;
    }
    requireValidRunTransition(current, next);
    const compact = compactWorkflowStoreRecord(next);
    await storage.set(makeRunKey(namespace, runId), toStorageValue(compact));
    return compact;
  }

  requireValidRunTransition(current, next);
  const compact = compactWorkflowStoreRecord(next);
  const updated = await storage.compareAndSet(
    makeRunKey(namespace, runId),
    toStorageValue(current),
    toStorageValue(compact),
  );
  return updated ? compact : undefined;
}

export async function getWorkflowRun(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<WorkflowRunRecord | undefined> {
  const run = await storage.get(makeRunKey(namespace, runId));
  // Workflow run keys are written only by this store.
  // @temelj/storage cannot narrow by key.
  return isReadableWorkflowRunRecord(run, namespace) ? run : undefined;
}

export async function listWorkflowRuns(
  storage: WorkflowStorage,
  namespace: string,
  options?: WorkflowListRunsOptions,
): Promise<readonly WorkflowRunRecord[]> {
  const runs = await queryWorkflowRuns(storage, namespace, options, {
    label: "Workflow run list options",
    sort: true,
  });
  return limitWorkflowItems(runs, options?.limit);
}

export async function listWorkflowRunsPage(
  storage: WorkflowStorage,
  namespace: string,
  options?: WorkflowListRunsPageOptions,
): Promise<WorkflowPage<WorkflowRunRecord>> {
  const runs = await queryWorkflowRuns(
    storage,
    namespace,
    { ...options, limit: undefined },
    {
      label: "Workflow run page options",
      sort: true,
    },
  );
  return pageItems(runs, options, "Workflow run page", makeWorkflowRunCursorKey);
}

export async function countWorkflowRuns(
  storage: WorkflowStorage,
  namespace: string,
  options?: WorkflowListRunsOptions,
): Promise<number> {
  // Generic storage has no portable count primitive, so count the filtered query result.
  return (
    await queryWorkflowRuns(storage, namespace, options, {
      label: "Workflow run list options",
      sort: false,
    })
  ).length;
}

export async function updateWorkflowRun(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowRunReader,
  run: WorkflowRunRecord,
): Promise<WorkflowRunRecord> {
  const runId = run.id;
  if (run.namespace !== namespace) {
    WorkflowStateError.runNamespaceMismatch(String(run.namespace), namespace);
  }
  const current = await store.getRun(runId);
  if (current !== undefined) {
    requireValidRunTransition(current, run);
  }
  const compact = compactWorkflowStoreRecord(run);
  await storage.set(makeRunKey(namespace, runId), toStorageValue(compact));
  return compact;
}

export async function claimWorkflowRun(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowRunClaimReader,
  options: WorkflowClaimRunOptions,
): Promise<WorkflowRunRecord | undefined> {
  const listOptions = claimableWorkflowRunListOptions(options);
  const run =
    options.runId === undefined
      ? await firstClaimableRun(store, options, listOptions)
      : await store.getRun(options.runId);
  if (run === undefined || !canClaimRun(run, options, listOptions)) {
    return undefined;
  }

  return await updateRunIfCurrent(
    storage,
    namespace,
    store,
    run,
    claimedRunPatch(run, options.workerId, options.now, options.leaseDuration),
  );
}

export async function extendWorkflowRunLease(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowRunReader,
  options: {
    readonly runId: RunId;
    readonly workerId: string;
    readonly attempts?: number;
    readonly now: Temporal.Instant;
    readonly leaseDuration: Temporal.Duration;
  },
): Promise<WorkflowRunRecord | undefined> {
  const run = await store.getRun(options.runId);
  if (!isWorkflowRunLeaseHeldByWorker(run, options)) {
    return undefined;
  }

  return await updateRunIfCurrent(
    storage,
    namespace,
    store,
    run,
    extendedRunLeasePatch(run, options.now, options.leaseDuration),
  );
}

export async function releaseWorkflowRunLease(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowRunReader,
  options: {
    readonly runId: RunId;
    readonly workerId: string;
    readonly attempts?: number;
    readonly now: Temporal.Instant;
  },
): Promise<WorkflowRunRecord | undefined> {
  const run = await store.getRun(options.runId);
  if (!isWorkflowRunLeaseHeldByWorker(run, options)) {
    return undefined;
  }

  return await updateRunIfCurrent(
    storage,
    namespace,
    store,
    run,
    releaseRunLeasePatch(run, options.now),
  );
}

export function isSameReadableWorkflowRunRevision(
  latest: WorkflowRunRecord | undefined,
  current: WorkflowRunRecord,
  namespace: string,
): boolean {
  return (
    latest !== undefined &&
    isReadableWorkflowRunRecord(latest, namespace) &&
    isSameWorkflowStorageValue(omitUndefined(latest), omitUndefined(current))
  );
}

export async function isStoredWorkflowRunRevisionCurrent(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: WorkflowRunRecord,
): Promise<boolean> {
  const latestRun = await getReadableStoredWorkflowRunValue(storage, namespace, currentRun.id);
  return isSameReadableWorkflowRunRevision(latestRun, currentRun, namespace);
}

export async function getReadableStoredWorkflowRun(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<WorkflowRunRecord | undefined> {
  const runValue = await storage.get(makeRunKey(namespace, runId));
  const run = parseStoredWorkflowRunRecord(runValue);
  return isReadableWorkflowRunRecord(run, namespace) ? run : undefined;
}

async function getReadableStoredWorkflowRunValue(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<WorkflowRunRecord | undefined> {
  const run = await storage.get(makeRunKey(namespace, runId));
  return isReadableWorkflowRunRecord(run, namespace) ? run : undefined;
}

export async function requireReadableStoredWorkflowRun(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<WorkflowRunRecord> {
  const run = await getReadableStoredWorkflowRun(storage, namespace, runId);
  if (run === undefined) {
    WorkflowRunNotFoundError.notFound(runId);
  }
  return run;
}

export function shouldRollbackAppendedEventForRun(
  namespace: string,
  run: WorkflowRunRecord | undefined,
  event: EventRecord,
): boolean {
  if (run === undefined || !isReadableWorkflowRunRecord(run, namespace)) {
    return true;
  }
  return (
    isTerminalWorkflowRunStatus(run.status) && !isTerminalWorkflowLifecycleEventForRun(run, event)
  );
}

export function isWorkflowRunStaleForAppend(
  currentRun: WorkflowRunRecord,
  event: EventRecord,
): boolean {
  return (
    isTerminalWorkflowRunStatus(currentRun.status) &&
    !isTerminalWorkflowLifecycleEventForRun(currentRun, event)
  );
}

export async function rollbackAppendedEventIfRunStale(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  events: readonly EventRecord[],
): Promise<boolean> {
  const run = await getReadableStoredWorkflowRunValue(storage, namespace, runId);
  if (!shouldRollbackAppendedEventForRun(namespace, run, event)) {
    return false;
  }
  await rollbackAppendedEventIfCurrent(storage, namespace, runId, events);
  return true;
}

export function claimedRunPatch(
  run: WorkflowRunRecord,
  workerId: WorkerId,
  now: Temporal.Instant,
  leaseDuration: Temporal.Duration,
): WorkflowRunRecord {
  const timestamp = now;
  const lastTransitionReason = isStaleLeaseClaim(run, now) ? "reclaimed" : "claimed";

  return {
    ...run,
    status: "running",
    attempts: nextRunAttempt(run.attempts),
    idempotencyKey: run.idempotencyKey,
    parentRunId: run.parentRunId,
    parentStepId: run.parentStepId,
    parentStepName: run.parentStepName,
    parentStepAttempt: run.parentStepAttempt,
    workerId,
    createdAt: run.createdAt,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason,
    startedAt: run.startedAt ?? timestamp,
    leaseExpiresAt: now.add(leaseDuration),
    deadlineAt: run.deadlineAt,
    availableAt: undefined,
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
  };
}

export function extendedRunLeasePatch(
  run: WorkflowRunRecord,
  now: Temporal.Instant,
  leaseDuration: Temporal.Duration,
): WorkflowRunRecord {
  const timestamp = now;
  return {
    ...run,
    idempotencyKey: run.idempotencyKey,
    parentRunId: run.parentRunId,
    parentStepId: run.parentStepId,
    parentStepName: run.parentStepName,
    parentStepAttempt: run.parentStepAttempt,
    createdAt: run.createdAt,
    updatedAt: timestamp,
    lastTransitionAt: run.lastTransitionAt ?? timestamp,
    deadlineAt: run.deadlineAt,
    startedAt: run.startedAt ?? timestamp,
    leaseExpiresAt: now.add(leaseDuration),
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
  };
}

export function releaseRunLeasePatch(
  run: WorkflowRunRecord,
  now: Temporal.Instant,
): WorkflowRunRecord {
  const timestamp = now;
  return {
    ...run,
    status: "waiting",
    idempotencyKey: run.idempotencyKey,
    parentRunId: run.parentRunId,
    parentStepId: run.parentStepId,
    parentStepName: run.parentStepName,
    parentStepAttempt: run.parentStepAttempt,
    availableAt: timestamp,
    createdAt: run.createdAt,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "waiting",
    deadlineAt: run.deadlineAt,
    startedAt: run.startedAt ?? timestamp,
    retryAt: undefined,
    retryReason: undefined,
    retryAttempt: undefined,
    retryStepId: undefined,
    retryStepName: undefined,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
    workerId: undefined,
    leaseExpiresAt: undefined,
  };
}

export async function firstClaimableRun(
  store: WorkflowRunClaimReader,
  options: WorkflowClaimRunOptions,
  listOptions: WorkflowListRunsOptions,
): Promise<WorkflowRunRecord | undefined> {
  const runs = await store.listRuns(listOptions);
  return runs.find((run) => canClaimRun(run, options, listOptions));
}

function claimableWorkflowRunListOptions(
  options: WorkflowClaimRunOptions,
): WorkflowListRunsOptions {
  return {
    ...options,
    workerId: undefined,
    availableAtFrom: undefined,
    availableAtTo: undefined,
    retryAtFrom: undefined,
    retryAtTo: undefined,
    leaseExpiresAtFrom: undefined,
    leaseExpiresAtTo: undefined,
  };
}

export function canClaimRun(
  run: WorkflowRunRecord,
  options: WorkflowClaimRunOptions,
  listOptions: WorkflowListRunsOptions,
): boolean {
  if (!matchesClaimableWorkflowRunListOptions(run, listOptions)) {
    return false;
  }
  if (run.status === "pending" || run.status === "waiting") {
    return (
      run.availableAt === undefined || Temporal.Instant.compare(run.availableAt, options.now) <= 0
    );
  }
  if (run.status !== "running") {
    return false;
  }
  if (run.workerId === undefined) {
    return true;
  }
  if (run.leaseExpiresAt === undefined) {
    return true;
  }
  return Temporal.Instant.compare(run.leaseExpiresAt, options.now) <= 0;
}

function isWorkflowRunLeaseHeldByWorker(
  run: WorkflowRunRecord | undefined,
  options: {
    readonly workerId: string;
    readonly attempts?: number;
    readonly now: Temporal.Instant;
  },
): run is WorkflowRunRecord {
  return (
    run !== undefined &&
    run.status === "running" &&
    run.workerId === options.workerId &&
    (options.attempts === undefined || run.attempts === options.attempts) &&
    run.leaseExpiresAt !== undefined &&
    Temporal.Instant.compare(run.leaseExpiresAt, options.now) > 0
  );
}

function matchesClaimableWorkflowRunListOptions(
  run: WorkflowRunRecord,
  listOptions: WorkflowListRunsOptions,
): boolean {
  return (
    matchesWorkflowRunListOptions(run, listOptions) &&
    (listOptions.retryReason !== undefined || run.retryReason === undefined)
  );
}

export function isStaleLeaseClaim(run: WorkflowRunRecord, now: Temporal.Instant): boolean {
  if (run.status !== "running") {
    return false;
  }
  if (run.workerId === undefined) {
    return true;
  }
  if (run.leaseExpiresAt === undefined) {
    return true;
  }
  return Temporal.Instant.compare(run.leaseExpiresAt, now) <= 0;
}
