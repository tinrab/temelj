import { deepEquals } from "@temelj/value";

import type { EventRecord } from "../types/events.ts";
import type { RunId, WorkerId } from "../types/ids.ts";
import type { WorkflowPage } from "../types/pagination.ts";
import type { ListRunsOptions, ListRunsPageOptions } from "../types/run-list.ts";
import type { RunRecord } from "../types/run.ts";
import type { ClaimRunOptions, WorkflowStorage } from "../types/store.ts";

import { omitUndefined, limitItems } from "../collection.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowStateError } from "../errors/mod.ts";
import { WorkflowRunNotFoundError } from "../errors/run.ts";
import { makeRunCursorKey, pageItems } from "../pagination.ts";
import {
  CLEARED_LEASE,
  CLEARED_RETRY,
  isTerminalEventForRun,
  isTerminalRunStatus,
  nextRunAttempt,
  UNFINISHED,
} from "../run-status.ts";
import { makeRunKey } from "../store-keys.ts";
import { supportsConditionalWrite } from "./capabilities.ts";
import { rollbackAppendedEventIfCurrent } from "./events.ts";
import { matchesRunListOptions, queryRuns } from "./query.ts";
import { toStorageValue } from "./storage-value.ts";
import {
  isReadableRunRecord,
  parseStoredRunRecord,
  requireReadableStoreRun,
  requireValidRunTransition,
} from "./validation.ts";

interface RunReader {
  getRun(runId: RunId): Promise<RunRecord | undefined>;
}

interface RunClaimReader extends RunReader {
  listRuns(options?: ListRunsOptions): Promise<readonly RunRecord[]>;
}

export async function updateRunIfCurrent(
  storage: WorkflowStorage,
  namespace: string,
  store: RunReader,
  current: RunRecord,
  next: RunRecord,
): Promise<RunRecord | undefined> {
  const runId = current.id;
  const nextRunId = next.id;

  if (runId !== nextRunId) {
    throw new WorkflowStateError(`Workflow store runId mismatch: ${runId} !== ${nextRunId}`, {
      code: WorkflowErrorCode.STATE_RUN_ID_MISMATCH,
      details: { actual: runId, expected: nextRunId },
    });
  }

  requireReadableStoreRun(current, namespace);

  if (next.namespace !== namespace) {
    WorkflowStateError.runNamespaceMismatch(String(next.namespace), namespace);
  }

  if (!supportsConditionalWrite(storage)) {
    const latest = await store.getRun(runId);

    if (latest === undefined || !deepEquals(omitUndefined(latest), omitUndefined(current))) {
      return undefined;
    }

    requireValidRunTransition(current, next);
    const compact = omitUndefined(next);
    await storage.set(makeRunKey(namespace, runId), toStorageValue(compact));

    return compact;
  }

  requireValidRunTransition(current, next);
  const compact = omitUndefined(next);

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
): Promise<RunRecord | undefined> {
  const run = await storage.get(makeRunKey(namespace, runId));

  // Workflow run keys are written only by this store.
  // @temelj/storage cannot narrow by key.
  return isReadableRunRecord(run, namespace) ? run : undefined;
}

export async function listWorkflowRuns(
  storage: WorkflowStorage,
  namespace: string,
  options?: ListRunsOptions,
): Promise<readonly RunRecord[]> {
  const runs = await queryRuns(storage, namespace, options, {
    label: "Workflow run list options",
    sort: true,
  });

  return limitItems(runs, options?.limit);
}

export async function listWorkflowRunsPage(
  storage: WorkflowStorage,
  namespace: string,
  options?: ListRunsPageOptions,
): Promise<WorkflowPage<RunRecord>> {
  const runs = await queryRuns(
    storage,
    namespace,
    { ...options, limit: undefined },
    {
      label: "Workflow run page options",
      sort: true,
    },
  );

  return pageItems(runs, options, "Workflow run page", makeRunCursorKey);
}

export async function countWorkflowRuns(
  storage: WorkflowStorage,
  namespace: string,
  options?: ListRunsOptions,
): Promise<number> {
  // Generic storage has no portable count primitive, so count the filtered query result.
  return (
    await queryRuns(storage, namespace, options, {
      label: "Workflow run list options",
      sort: false,
    })
  ).length;
}

export async function updateWorkflowRun(
  storage: WorkflowStorage,
  namespace: string,
  store: RunReader,
  run: RunRecord,
): Promise<RunRecord> {
  const runId = run.id;

  if (run.namespace !== namespace) {
    WorkflowStateError.runNamespaceMismatch(String(run.namespace), namespace);
  }

  const current = await store.getRun(runId);

  if (current !== undefined) {
    requireValidRunTransition(current, run);
  }

  const compact = omitUndefined(run);
  await storage.set(makeRunKey(namespace, runId), toStorageValue(compact));

  return compact;
}

export async function claimWorkflowRun(
  storage: WorkflowStorage,
  namespace: string,
  store: RunClaimReader,
  options: ClaimRunOptions,
): Promise<RunRecord | undefined> {
  const listOptions = claimableRunListOptions(options);

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
  store: RunReader,
  options: {
    readonly runId: RunId;
    readonly workerId: string;
    readonly attempts?: number;
    readonly now: Temporal.Instant;
    readonly leaseDuration: Temporal.Duration;
  },
): Promise<RunRecord | undefined> {
  const run = await store.getRun(options.runId);

  if (!isRunLeaseHeldByWorker(run, options)) {
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
  store: RunReader,
  options: {
    readonly runId: RunId;
    readonly workerId: string;
    readonly attempts?: number;
    readonly now: Temporal.Instant;
  },
): Promise<RunRecord | undefined> {
  const run = await store.getRun(options.runId);

  if (!isRunLeaseHeldByWorker(run, options)) {
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

function isSameReadableRunRevision(
  latest: RunRecord | undefined,
  current: RunRecord,
  namespace: string,
): boolean {
  return (
    latest !== undefined &&
    isReadableRunRecord(latest, namespace) &&
    deepEquals(omitUndefined(latest), omitUndefined(current))
  );
}

export async function isStoredRunRevisionCurrent(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: RunRecord,
): Promise<boolean> {
  const latestRun = await getWorkflowRun(storage, namespace, currentRun.id);

  return isSameReadableRunRevision(latestRun, currentRun, namespace);
}

export async function getReadableStoredRun(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<RunRecord | undefined> {
  const runValue = await storage.get(makeRunKey(namespace, runId));
  const run = parseStoredRunRecord(runValue);

  return isReadableRunRecord(run, namespace) ? run : undefined;
}

export async function requireReadableStoredRun(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<RunRecord> {
  const run = await getReadableStoredRun(storage, namespace, runId);

  if (run === undefined) {
    WorkflowRunNotFoundError.notFound(runId);
  }

  return run;
}

function shouldRollbackAppendedEventForRun(
  namespace: string,
  run: RunRecord | undefined,
  event: EventRecord,
): boolean {
  if (run === undefined || !isReadableRunRecord(run, namespace)) {
    return true;
  }

  return isTerminalRunStatus(run.status) && !isTerminalEventForRun(run, event);
}

export function isRunStaleForAppend(currentRun: RunRecord, event: EventRecord): boolean {
  return isTerminalRunStatus(currentRun.status) && !isTerminalEventForRun(currentRun, event);
}

export async function rollbackAppendedEventIfRunStale(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  events: readonly EventRecord[],
): Promise<boolean> {
  const run = await getWorkflowRun(storage, namespace, runId);

  if (!shouldRollbackAppendedEventForRun(namespace, run, event)) {
    return false;
  }

  await rollbackAppendedEventIfCurrent(storage, namespace, runId, events);

  return true;
}

function claimedRunPatch(
  run: RunRecord,
  workerId: WorkerId,
  now: Temporal.Instant,
  leaseDuration: Temporal.Duration,
): RunRecord {
  const lastTransitionReason = isStaleLeaseClaim(run, now) ? "reclaimed" : "claimed";

  return {
    ...run,
    status: "running",
    attempts: nextRunAttempt(run.attempts),
    workerId,
    updatedAt: now,
    lastTransitionAt: now,
    lastTransitionReason,
    startedAt: run.startedAt ?? now,
    leaseExpiresAt: now.add(leaseDuration),
    availableAt: undefined,
    ...CLEARED_RETRY,
    ...UNFINISHED,
  };
}

function extendedRunLeasePatch(
  run: RunRecord,
  now: Temporal.Instant,
  leaseDuration: Temporal.Duration,
): RunRecord {
  return {
    ...run,
    updatedAt: now,
    lastTransitionAt: run.lastTransitionAt ?? now,
    startedAt: run.startedAt ?? now,
    leaseExpiresAt: now.add(leaseDuration),
    ...CLEARED_RETRY,
    ...UNFINISHED,
  };
}

function releaseRunLeasePatch(run: RunRecord, now: Temporal.Instant): RunRecord {
  return {
    ...run,
    status: "waiting",
    availableAt: now,
    updatedAt: now,
    lastTransitionAt: now,
    lastTransitionReason: "waiting",
    startedAt: run.startedAt ?? now,
    ...CLEARED_RETRY,
    ...UNFINISHED,
    ...CLEARED_LEASE,
  };
}

async function firstClaimableRun(
  store: RunClaimReader,
  options: ClaimRunOptions,
  listOptions: ListRunsOptions,
): Promise<RunRecord | undefined> {
  const runs = await store.listRuns(listOptions);

  return runs.find((run) => canClaimRun(run, options, listOptions));
}

function claimableRunListOptions(options: ClaimRunOptions): ListRunsOptions {
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

function canClaimRun(
  run: RunRecord,
  options: ClaimRunOptions,
  listOptions: ListRunsOptions,
): boolean {
  if (!matchesClaimableRunListOptions(run, listOptions)) {
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

function isRunLeaseHeldByWorker(
  run: RunRecord | undefined,
  options: {
    readonly workerId: string;
    readonly attempts?: number;
    readonly now: Temporal.Instant;
  },
): run is RunRecord {
  return (
    run !== undefined &&
    run.status === "running" &&
    run.workerId === options.workerId &&
    (options.attempts === undefined || run.attempts === options.attempts) &&
    run.leaseExpiresAt !== undefined &&
    Temporal.Instant.compare(run.leaseExpiresAt, options.now) > 0
  );
}

function matchesClaimableRunListOptions(run: RunRecord, listOptions: ListRunsOptions): boolean {
  return (
    matchesRunListOptions(run, listOptions) &&
    (listOptions.retryReason !== undefined || run.retryReason === undefined)
  );
}

function isStaleLeaseClaim(run: RunRecord, now: Temporal.Instant): boolean {
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
