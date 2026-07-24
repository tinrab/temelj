import type { RunId } from "../../types/run.ts";

export interface WorkflowRecoveryTimestamp {
  readonly runId: RunId;
  readonly timestamp: Temporal.Instant;
}

export function isWorkflowRecoveryRunDueAt(
  timestamp: Temporal.Instant | undefined,
  now: Temporal.Instant,
): boolean {
  return timestamp === undefined || Temporal.Instant.compare(timestamp, now) <= 0;
}

export function earliestWorkflowRecoveryTimestamp(
  current: WorkflowRecoveryTimestamp | undefined,
  runId: RunId,
  timestamp: Temporal.Instant,
): WorkflowRecoveryTimestamp {
  return current === undefined || Temporal.Instant.compare(timestamp, current.timestamp) < 0
    ? { runId, timestamp }
    : current;
}

export function earliestWorkflowRecoveryInstant(
  current: Temporal.Instant | undefined,
  timestamp: Temporal.Instant,
): Temporal.Instant {
  return current === undefined || Temporal.Instant.compare(timestamp, current) < 0
    ? timestamp
    : current;
}

export function latestOptionalWorkflowRecoveryInstant(
  current: Temporal.Instant | undefined,
  timestamp: Temporal.Instant | undefined,
): Temporal.Instant | undefined {
  return timestamp === undefined ||
    (current !== undefined && Temporal.Instant.compare(timestamp, current) <= 0)
    ? current
    : timestamp;
}
