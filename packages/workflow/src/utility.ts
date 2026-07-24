// Uncategorized utility functions.
// TODO: Refactor.

import { StandardSchemaValidationError } from "@temelj/standard-schema";

import type { EventRecord } from "./types/events.ts";
import type { RunId } from "./types/run-id.ts";
import type {
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowTerminalRunStatus,
} from "./types/run.ts";
import type { WorkflowStepAttemptRecord } from "./types/step-attempts.ts";
import type { WorkflowRunReaderRepository } from "./types/store.ts";
import type { WorkerId } from "./types/worker-id.ts";

import { WorkflowOptionsError } from "./errors/base.ts";
import { WorkflowDurationError } from "./errors/failures.ts";
import { WorkflowRunNotFoundError } from "./errors/run.ts";
import { makeWorkflowStepAttemptKey } from "./history/attempt-key.ts";
import { WorkflowRecordedIdContext } from "./types/engine-options.ts";

// String, ID, and object helpers.

/** Converts arbitrary command ID text into a stable segment safe for recorded IDs. */
export function sanitizeRecordedIdPart(value: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized === "" ? "run" : sanitized;
}

/** Formats standard-schema validation issues into a single human-readable message. */
export function formatStandardSchemaIssues(error: StandardSchemaValidationError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path?.join(".");
      return path === undefined || path === "" ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}

/** Returns the greatest positive safe integer from two optional values. */
export function greatestOptionalNumber(
  current: number | undefined,
  next: number | undefined,
): number | undefined {
  if (next === undefined || !isPositiveSafeInteger(next)) {
    return current;
  }
  if (current === undefined) {
    return next;
  }
  return Math.max(current, next);
}

// Safe integer helpers.

/** Returns whether a value is a positive safe integer. */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Returns whether a value is a non-negative safe integer. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Returns the next positive safe integer, or undefined when the input cannot be advanced. */
export function nextPositiveSafeInteger(value: number): number | undefined {
  return isPositiveSafeInteger(value) && value < Number.MAX_SAFE_INTEGER ? value + 1 : undefined;
}

// Run status helpers.

export function isWorkflowRunStatus(status: string): status is WorkflowRunStatus {
  return (
    status === "pending" ||
    status === "running" ||
    status === "waiting" ||
    status === "completed" ||
    status === "failed" ||
    status === "canceled"
  );
}

export function isActiveWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return status === "pending" || status === "running" || status === "waiting";
}

export function isScheduledWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return status === "pending" || status === "waiting";
}

/** Returns whether a workflow run status is terminal for its current execution attempt. */
export function isTerminalWorkflowRunStatus(
  status: WorkflowRunStatus,
): status is WorkflowTerminalRunStatus {
  return status === "completed" || status === "failed" || status === "canceled";
}

/** Returns whether an event is the terminal lifecycle event matching a run's current status. */
export function isTerminalWorkflowLifecycleEventForRun(
  run: WorkflowRunRecord,
  event: EventRecord,
): boolean {
  return (
    (run.status === "completed" && event.kind === "workflow_completed") ||
    (run.status === "failed" && event.kind === "workflow_failed")
  );
}

// Runtime, storage, and validation helpers.

/** Creates a default worker identifier using the current time and a random suffix. */
export function createDefaultWorkerId(): WorkerId {
  const timestamp = Temporal.Now.instant().epochMilliseconds.toString(36);
  return `worker_${timestamp}_${Math.random().toString(36).slice(2)}`;
}

/** Returns a duration's total milliseconds, or NaN when Temporal cannot represent it safely. */
export function durationTotal(value: Temporal.Duration): number {
  const total = value.total({ unit: "millisecond" });
  return Number.isFinite(total) ? total : Number.NaN;
}

export function safeDuration(value: number, label: string): number {
  try {
    resolveSafeRetryDelay(value, label);
  } catch (error) {
    if (!(error instanceof WorkflowOptionsError)) {
      throw error;
    }
    WorkflowDurationError.timerSafe(label);
  }
  return value;
}

export function durationAmount(value: Temporal.Duration, label: string): number {
  if (!(value instanceof Temporal.Duration)) {
    WorkflowDurationError.temporalDuration(label);
  }
  const amount = value.total({ unit: "millisecond" });
  if (!Number.isFinite(amount)) {
    WorkflowDurationError.finite(label);
  }
  return amount;
}

/** Returns a retry delay in milliseconds and reports invalid numbers as duration errors. */
export function resolveSafeRetryDelay(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value !== undefined && !Number.isSafeInteger(value)) {
    WorkflowOptionsError.safeDuration(label);
  }
  return value;
}

export function nextRunAttempt(value: number | undefined): number {
  if (value === undefined || !isNonNegativeSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    return 1;
  }
  return value + 1;
}

export function limitWorkflowItems<T>(
  items: readonly T[],
  limit: number | undefined,
): readonly T[] {
  if (limit === undefined) {
    return items;
  }
  return items.slice(0, limit);
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function positiveSafeInteger(value: number, label: string): number {
  if (!isPositiveSafeInteger(value)) {
    WorkflowDurationError.positiveSafeInteger(label);
  }
  return value;
}

export function resolvePositiveSafeIntegerOption(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPositiveSafeInteger(value)) {
    WorkflowOptionsError.positiveSafeInteger(label);
  }
  return value;
}

export async function getRequiredRun(
  store: WorkflowRunReaderRepository,
  runId: RunId,
): Promise<WorkflowRunRecord> {
  const run = await store.getRun(runId);
  if (run === undefined) {
    WorkflowRunNotFoundError.notFound(runId);
  }
  return run;
}

export function makeWorkflowRunStepAttemptKey(
  runId: RunId,
  attempt: WorkflowStepAttemptRecord,
): string {
  return `${runId}:${makeWorkflowStepAttemptKey(attempt.stepId, attempt.attempt)}`;
}

// Default ID factories.

/** Creates the default workflow run ID factory. */
export function createDefaultRunIdFactory(
  now: () => Temporal.Instant = Temporal.Now.instant,
): () => string {
  return () => `run_${now().epochMilliseconds.toString(36)}_${randomIdPart()}`;
}

/** Creates the default workflow recorded command ID factory. */
export function createDefaultWorkflowRecordedIdFactory(
  createRunId: () => string,
): (context: WorkflowRecordedIdContext) => string {
  return (context) => `wf_${sanitizeRecordedIdPart(context.runId)}_${createRunId()}`;
}

function randomIdPart(): string {
  return Math.random().toString(36).slice(2);
}
