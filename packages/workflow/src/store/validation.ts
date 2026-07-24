import type { StorageValue } from "@temelj/storage";

import type { CleanupMarkerRecord } from "../types/cleanup.ts";
import type { EventRecord } from "../types/events.ts";
import type { LockRecord } from "../types/lock.ts";
import type {
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowRunTransitionReason,
} from "../types/run.ts";
import type { ScheduleRecord } from "../types/schedule.ts";
import type { WorkflowStepAttemptRecord } from "../types/step-attempts.ts";
import type { WorkflowMessageIdempotencyIndex } from "../types/store.ts";

import { WorkflowRunNotFoundError, WorkflowRunTransitionError } from "../errors/mod.ts";
import { workflowCleanupMarkerRecordSchema } from "../types/cleanup.ts";
import { workflowEventRecordSchema } from "../types/events.ts";
import { workflowLockRecordSchema } from "../types/lock.ts";
import { workflowRunRecordSchema } from "../types/run.ts";
import { workflowScheduleRecordSchema } from "../types/schedule.ts";
import { workflowStepAttemptRecordSchema } from "../types/step-attempts.ts";
import { workflowMessageIdempotencyIndexSchema } from "./schema.ts";

/** Returns whether an unknown value is a readable run record in the expected namespace. */
export function isReadableWorkflowRunRecord(
  run: unknown,
  expectedNamespace: string,
): run is WorkflowRunRecord {
  const parsed = workflowRunRecordSchema.safeParse(run);
  return parsed.success && parsed.data.namespace === expectedNamespace;
}

/** Returns whether an unknown value is a run record that can participate in indexed list queries. */
export function isListableWorkflowRunRecord(
  run: unknown,
  expectedNamespace: string,
): run is WorkflowRunRecord & { readonly lastTransitionReason: WorkflowRunTransitionReason } {
  return isReadableWorkflowRunRecord(run, expectedNamespace);
}

/** Parses a stored workflow run record, if one exists. */
export function parseStoredWorkflowRunRecord(
  value: StorageValue | undefined,
): WorkflowRunRecord | undefined {
  return value === undefined ? undefined : workflowRunRecordSchema.parse(value);
}

/** Returns whether an unknown value is a readable schedule record in the expected namespace. */
export function isReadableScheduleRecord<TInput = StorageValue>(
  schedule: unknown,
  expectedNamespace: string,
): schedule is ScheduleRecord<TInput> {
  const parsed = workflowScheduleRecordSchema.safeParse(schedule);
  return parsed.success && parsed.data.namespace === expectedNamespace;
}

/** Returns whether an unknown value is a readable lock record in the expected namespace. */
export function isReadableLockRecord(lock: unknown, expectedNamespace: string): lock is LockRecord {
  const parsed = workflowLockRecordSchema.safeParse(lock);
  return parsed.success && parsed.data.namespace === expectedNamespace;
}

/** Returns whether an unknown value is a readable durable workflow event record. */
export function isReadableEventRecord(event: unknown): event is EventRecord {
  return workflowEventRecordSchema.safeParse(event).success;
}

/** Parses a readable cleanup marker record, if the value has the expected shape. */
export function readableCleanupMarkerRecord(marker: unknown): CleanupMarkerRecord | undefined {
  const parsed = workflowCleanupMarkerRecordSchema.safeParse(marker);
  return parsed.success ? parsed.data : undefined;
}

/** Parses a stored materialized step-attempt record, if one exists. */
export function parseStoredWorkflowStepAttemptRecord(
  value: StorageValue | undefined,
): WorkflowStepAttemptRecord | undefined {
  return value === undefined ? undefined : workflowStepAttemptRecordSchema.parse(value);
}

/** Returns whether an unknown value is a readable message idempotency index record. */
export function isReadableMessageIdempotencyIndex(
  value: unknown,
): value is WorkflowMessageIdempotencyIndex {
  return workflowMessageIdempotencyIndexSchema.safeParse(value).success;
}

/** Returns whether the stored message idempotency index matches the expected logical index. */
export function isSameMessageIdempotencyIndex(
  current: unknown,
  value: WorkflowMessageIdempotencyIndex,
): boolean {
  const parsedCurrent = workflowMessageIdempotencyIndexSchema.safeParse(current);
  return (
    parsedCurrent.success &&
    parsedCurrent.data.runId === value.runId &&
    parsedCurrent.data.messageId === value.messageId &&
    Temporal.Instant.compare(parsedCurrent.data.timestamp, value.timestamp) === 0
  );
}

export function requireReadableStoreRun(run: WorkflowRunRecord, namespace: string): void {
  const runId = run.id;
  if (!isReadableWorkflowRunRecord(run, namespace)) {
    WorkflowRunNotFoundError.notFound(runId);
  }
}

export function requireValidRunTransition(
  current: WorkflowRunRecord,
  next: WorkflowRunRecord,
): void {
  if (current.status === next.status) {
    return;
  }
  if (canTransitionWorkflowRunStatus(current.status, next.status)) {
    return;
  }
  WorkflowRunTransitionError.invalidTransition(current.id, current.status, next.status);
}

/** Returns whether a run status transition is allowed by the workflow state machine. */
function canTransitionWorkflowRunStatus(from: WorkflowRunStatus, to: WorkflowRunStatus): boolean {
  switch (from) {
    case "pending":
      return to === "running" || to === "waiting" || to === "failed" || to === "canceled";
    case "running":
      return to === "waiting" || to === "completed" || to === "failed" || to === "canceled";
    case "waiting":
      return to === "running" || to === "failed" || to === "canceled";
    case "failed":
      return to === "pending";
    case "completed":
    case "canceled":
      return false;
  }
}
