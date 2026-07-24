import type { WorkflowListRunsOptions } from "../types/run-list.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { ListSchedulesOptions, ScheduleRecord } from "../types/schedule.ts";
import type {
  WorkflowListStepAttemptsOptions,
  WorkflowStepAttemptRecord,
} from "../types/step-attempts.ts";
import type {
  WorkflowEventReader,
  WorkflowRunReaderRepository,
  WorkflowStorage,
} from "../types/store.ts";

import { matchesOptionalValue, uniqueBy } from "../collection.ts";
import { WorkflowRunNotFoundError } from "../errors/mod.ts";
import { makeRunKeyPrefix, makeScheduleKeyPrefix } from "../store-keys.ts";
import {
  compareOptionalTimestamps,
  matchesOptionalDurationRange,
  matchesOptionalTimestampRange,
  matchesTimestampRange,
} from "../temporal.ts";
import { reconcileStepAttempts } from "./materialization.ts";
import { isListableWorkflowRunRecord, isReadableScheduleRecord } from "./validation.ts";

type WorkflowStepAttemptQueryStore = WorkflowRunReaderRepository & WorkflowEventReader;

export async function queryWorkflowRuns(
  storage: WorkflowStorage,
  namespace: string,
  options: WorkflowListRunsOptions | undefined,
  query: { readonly label: string; readonly sort: boolean },
): Promise<readonly WorkflowRunRecord[]> {
  // This intentionally scans the workflow namespace.
  // Indexed queries should be in @temelj/storage.
  const runs = (await storage.entries({ prefix: makeRunKeyPrefix(namespace) }))
    .map((entry: { readonly value: unknown }) => entry.value)
    .filter((run): run is WorkflowRunRecord => isListableWorkflowRunRecord(run, namespace))
    .filter((run) => matchesWorkflowRunListOptions(run, options));
  const uniqueRuns = uniqueBy(runs, (run) => run.id);
  if (!query.sort) {
    return uniqueRuns;
  }
  return [...uniqueRuns].sort(compareWorkflowRunsForQuery);
}

export async function queryWorkflowStepAttempts(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStepAttemptQueryStore,
  runId: RunId,
  options: WorkflowListStepAttemptsOptions | undefined,
  _query: { readonly label: string },
): Promise<readonly WorkflowStepAttemptRecord[]> {
  await getRequiredStoreRun(store, runId);
  const attempts = await reconcileStepAttempts(
    storage,
    namespace,
    runId,
    await store.getEvents(runId),
  );
  return attempts.filter((attempt) => matchesWorkflowStepAttemptListOptions(attempt, options));
}

export async function querySchedules(
  storage: WorkflowStorage,
  namespace: string,
  options: ListSchedulesOptions | undefined,
  _query: { readonly label: string },
): Promise<readonly ScheduleRecord[]> {
  const schedules = (await storage.entries({ prefix: makeScheduleKeyPrefix(namespace) }))
    .map((entry: { readonly value: unknown }) => entry.value)
    .filter((schedule): schedule is ScheduleRecord => isReadableScheduleRecord(schedule, namespace))
    .filter((schedule) => matchesScheduleListOptions(schedule, options))
    .sort(compareSchedulesForQuery);
  return uniqueBy(schedules, (schedule) => schedule.id);
}

function compareWorkflowRunsForQuery(left: WorkflowRunRecord, right: WorkflowRunRecord): number {
  const createdOrder = compareOptionalTimestamps(left.createdAt, right.createdAt);
  if (createdOrder !== 0) {
    return createdOrder;
  }
  return left.id.localeCompare(right.id);
}

function compareSchedulesForQuery(left: ScheduleRecord, right: ScheduleRecord): number {
  return (
    Temporal.Instant.compare(left.nextFireAt, right.nextFireAt) ||
    Temporal.Instant.compare(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export async function getRequiredStoreRun(
  store: WorkflowRunReaderRepository,
  runId: RunId,
): Promise<WorkflowRunRecord> {
  const run = await store.getRun(runId);
  if (run === undefined) {
    WorkflowRunNotFoundError.notFound(runId);
  }
  return run;
}

export function matchesWorkflowRunListOptions(
  run: WorkflowRunRecord,
  options: WorkflowListRunsOptions | undefined,
): boolean {
  if (options?.status !== undefined && !matchesOptionalValue(run.status, options.status)) {
    return false;
  }
  if (options?.workflowName !== undefined && run.workflowName !== options.workflowName) {
    return false;
  }
  if (options?.workflowVersion !== undefined && run.workflowVersion !== options.workflowVersion) {
    return false;
  }
  if (options?.idempotencyKey !== undefined && run.idempotencyKey !== options.idempotencyKey) {
    return false;
  }
  if (options?.workerId !== undefined && run.workerId !== options.workerId) {
    return false;
  }
  if (options?.parentRunId !== undefined && run.parentRunId !== options.parentRunId) {
    return false;
  }
  if (options?.parentStepId !== undefined && run.parentStepId !== options.parentStepId) {
    return false;
  }
  if (options?.parentStepName !== undefined && run.parentStepName !== options.parentStepName) {
    return false;
  }
  if (
    options?.parentStepAttempt !== undefined &&
    run.parentStepAttempt !== options.parentStepAttempt
  ) {
    return false;
  }
  if (
    options?.lastTransitionReason !== undefined &&
    !matchesOptionalValue(run.lastTransitionReason, options.lastTransitionReason)
  ) {
    return false;
  }
  if (
    options?.retryReason !== undefined &&
    (run.retryReason === undefined || !matchesOptionalValue(run.retryReason, options.retryReason))
  ) {
    return false;
  }
  if (!matchesRunAttributeFilters(run, options)) {
    return false;
  }
  return (
    matchesTimestampRange(run.createdAt, options?.createdAtFrom, options?.createdAtTo) &&
    matchesTimestampRange(run.updatedAt, options?.updatedAtFrom, options?.updatedAtTo) &&
    matchesOptionalTimestampRange(run.finishedAt, options?.finishedAtFrom, options?.finishedAtTo) &&
    matchesOptionalTimestampRange(run.startedAt, options?.startedAtFrom, options?.startedAtTo) &&
    matchesOptionalTimestampRange(
      run.availableAt,
      options?.availableAtFrom,
      options?.availableAtTo,
    ) &&
    matchesOptionalTimestampRange(
      run.leaseExpiresAt,
      options?.leaseExpiresAtFrom,
      options?.leaseExpiresAtTo,
    ) &&
    matchesOptionalTimestampRange(run.retryAt, options?.retryAtFrom, options?.retryAtTo)
  );
}

export function matchesWorkflowStepAttemptListOptions(
  attempt: WorkflowStepAttemptRecord,
  options: WorkflowListStepAttemptsOptions | undefined,
): boolean {
  if (options?.status !== undefined && !matchesOptionalValue(attempt.status, options.status)) {
    return false;
  }
  if (options?.kind !== undefined && !matchesOptionalValue(attempt.kind, options.kind)) {
    return false;
  }
  if (options?.stepId !== undefined && attempt.stepId !== options.stepId) {
    return false;
  }
  if (options?.stepName !== undefined && attempt.stepName !== options.stepName) {
    return false;
  }
  if (options?.attempt !== undefined && attempt.attempt !== options.attempt) {
    return false;
  }
  if (options?.childRunId !== undefined && attempt.childRunId !== options.childRunId) {
    return false;
  }
  if (options?.workflowName !== undefined && attempt.workflowName !== options.workflowName) {
    return false;
  }
  if (
    options?.workflowVersion !== undefined &&
    attempt.workflowVersion !== options.workflowVersion
  ) {
    return false;
  }
  if (options?.messageId !== undefined && attempt.messageId !== options.messageId) {
    return false;
  }
  if (options?.targetRunId !== undefined && attempt.targetRunId !== options.targetRunId) {
    return false;
  }
  return (
    matchesTimestampRange(attempt.createdAt, options?.createdAtFrom, options?.createdAtTo) &&
    matchesTimestampRange(attempt.startedAt, options?.startedAtFrom, options?.startedAtTo) &&
    matchesOptionalTimestampRange(
      attempt.finishedAt,
      options?.finishedAtFrom,
      options?.finishedAtTo,
    ) &&
    matchesOptionalTimestampRange(attempt.until, options?.untilFrom, options?.untilTo) &&
    matchesOptionalDurationRange(attempt.duration, options?.durationFrom, options?.durationTo) &&
    matchesOptionalTimestampRange(
      attempt.timeoutAt,
      options?.timeoutAtFrom,
      options?.timeoutAtTo,
    ) &&
    matchesOptionalTimestampRange(
      attempt.messageTimestamp,
      options?.messageTimestampFrom,
      options?.messageTimestampTo,
    )
  );
}

export function matchesScheduleListOptions(
  schedule: ScheduleRecord,
  options: ListSchedulesOptions | undefined,
): boolean {
  if (options?.status !== undefined && !matchesOptionalValue(schedule.status, options.status)) {
    return false;
  }
  if (options?.workflowName !== undefined && schedule.workflowName !== options.workflowName) {
    return false;
  }
  if (
    options?.workflowVersion !== undefined &&
    schedule.workflowVersion !== options.workflowVersion
  ) {
    return false;
  }
  return true;
}

function matchesRunAttributeFilters(
  run: WorkflowRunRecord,
  options: WorkflowListRunsOptions | undefined,
): boolean {
  if (options === undefined) {
    return true;
  }
  if (options.attributes !== undefined) {
    for (const [key, value] of Object.entries(options.attributes)) {
      if (!Object.is(run.attributes?.[key], value)) {
        return false;
      }
    }
  }
  if (options.attributeExists !== undefined) {
    const keys = Array.isArray(options.attributeExists)
      ? options.attributeExists
      : [options.attributeExists];
    if (!keys.every((key) => run.attributes?.[key] !== undefined)) {
      return false;
    }
  }
  if (options.attributeMissing !== undefined) {
    const keys = Array.isArray(options.attributeMissing)
      ? options.attributeMissing
      : [options.attributeMissing];
    if (!keys.every((key) => run.attributes?.[key] === undefined)) {
      return false;
    }
  }
  return true;
}
