import type { StorageValue } from "@temelj/storage";

import { ss } from "@temelj/standard-schema";

import type { CleanupMarkerRecord } from "../types/cleanup.ts";
import type { EventRecord } from "../types/events.ts";
import type { LockRecord } from "../types/lock.ts";
import type { RunRecord, RunStatus, RunTransitionReason } from "../types/run.ts";
import type { ScheduleRecord } from "../types/schedule.ts";
import type { StepAttemptRecord } from "../types/step-attempts.ts";
import type { MessageIdempotencyIndex } from "../types/store.ts";

import { WorkflowRunNotFoundError, WorkflowRunTransitionError } from "../errors/mod.ts";
import { parse } from "../schema/common.ts";
import { eventRecordSchema } from "../schema/events.ts";
import { runRecordSchema } from "../schema/run.ts";
import {
  lockRecordSchema,
  cleanupMarkerRecordSchema,
  scheduleRecordSchema,
  stepAttemptRecordSchema,
  messageIdempotencyIndexSchema,
} from "../schema/store.ts";

/** Returns whether an unknown value is a readable run record in the expected namespace. */
export function isReadableRunRecord(run: unknown, expectedNamespace: string): run is RunRecord {
  const parsed = ss.safeParseSync(runRecordSchema, run);

  return parsed.success && parsed.value.namespace === expectedNamespace;
}

/** Returns whether an unknown value is a run record that can participate in indexed list queries. */
export function isListableRunRecord(
  run: unknown,
  expectedNamespace: string,
): run is RunRecord & { readonly lastTransitionReason: RunTransitionReason } {
  return isReadableRunRecord(run, expectedNamespace);
}

/** Parses a stored workflow run record, if one exists. */
export function parseStoredRunRecord(value: StorageValue | undefined): RunRecord | undefined {
  return value === undefined ? undefined : parse(runRecordSchema, value);
}

/** Returns whether an unknown value is a readable schedule record in the expected namespace. */
export function isReadableScheduleRecord(
  schedule: unknown,
  expectedNamespace: string,
): schedule is ScheduleRecord {
  const parsed = ss.safeParseSync(scheduleRecordSchema, schedule);

  return parsed.success && parsed.value.namespace === expectedNamespace;
}

/** Returns whether an unknown value is a readable lock record in the expected namespace. */
export function isReadableLockRecord(lock: unknown, expectedNamespace: string): lock is LockRecord {
  const parsed = ss.safeParseSync(lockRecordSchema, lock);

  return parsed.success && parsed.value.namespace === expectedNamespace;
}

export function isReadableEventRecord(event: unknown): event is EventRecord {
  return ss.safeParseSync(eventRecordSchema, event).success;
}

/** Parses a readable cleanup marker record, if the value has the expected shape. */
export function readableCleanupMarkerRecord(
  marker: StorageValue | undefined,
): CleanupMarkerRecord | undefined {
  const parsed = ss.safeParseSync(cleanupMarkerRecordSchema, marker);

  return parsed.success ? parsed.value : undefined;
}

/** Parses a stored materialized step-attempt record, if one exists. */
export function parseStoredStepAttemptRecord(
  value: StorageValue | undefined,
): StepAttemptRecord | undefined {
  return value === undefined ? undefined : parse(stepAttemptRecordSchema, value);
}

export function isReadableMessageIdempotencyIndex(
  value: unknown,
): value is MessageIdempotencyIndex {
  return ss.safeParseSync(messageIdempotencyIndexSchema, value).success;
}

/** Returns whether the stored message idempotency index matches the expected logical index. */
export function isSameMessageIdempotencyIndex(
  current: StorageValue | MessageIdempotencyIndex | undefined,
  value: MessageIdempotencyIndex,
): boolean {
  const parsedCurrent = ss.safeParseSync(messageIdempotencyIndexSchema, current);

  return (
    parsedCurrent.success &&
    parsedCurrent.value.runId === value.runId &&
    parsedCurrent.value.messageId === value.messageId &&
    Temporal.Instant.compare(parsedCurrent.value.timestamp, value.timestamp) === 0
  );
}

export function requireReadableStoreRun(run: RunRecord, namespace: string): void {
  const runId = run.id;

  const parsed = ss.safeParseSync(runRecordSchema, run);

  if (!parsed.success || parsed.value.namespace !== namespace) {
    WorkflowRunNotFoundError.notFound(runId);
  }
}

export function requireValidRunTransition(current: RunRecord, next: RunRecord): void {
  if (current.status === next.status) {
    return;
  }

  if (canTransitionRunStatus(current.status, next.status)) {
    return;
  }

  throw new WorkflowRunTransitionError(current.id, current.status, next.status);
}

/** Returns whether a run status transition is allowed by the workflow state machine. */
function canTransitionRunStatus(from: RunStatus, to: RunStatus): boolean {
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
