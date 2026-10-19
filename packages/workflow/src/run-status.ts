import type { EventRecord } from "./types/events.ts";
import type { RunRecord, RunStatus, TerminalRunStatus } from "./types/run.ts";

import { isNonNegativeSafeInteger } from "./values.ts";

export function isRunStatus(status: string): status is RunStatus {
  return (
    status === "pending" ||
    status === "running" ||
    status === "waiting" ||
    status === "completed" ||
    status === "failed" ||
    status === "canceled"
  );
}

export function isActiveRunStatus(status: RunStatus): boolean {
  return status === "pending" || status === "running" || status === "waiting";
}

export function isScheduledRunStatus(status: RunStatus): boolean {
  return status === "pending" || status === "waiting";
}

/** Returns whether a workflow run status is terminal for its current execution attempt. */
export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
  return status === "completed" || status === "failed" || status === "canceled";
}

/** Returns whether an event is the terminal lifecycle event matching a run's current status. */
export function isTerminalEventForRun(run: RunRecord, event: EventRecord): boolean {
  return (
    (run.status === "completed" && event.kind === "workflow_completed") ||
    (run.status === "failed" && event.kind === "workflow_failed")
  );
}

export function nextRunAttempt(value: number | undefined): number {
  if (value === undefined || !isNonNegativeSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    return 1;
  }

  return value + 1;
}

/** Run fields cleared together when a run no longer waits on a retry, a lease, or a result. */
export const CLEARED_RETRY = {
  retryAt: undefined,
  retryReason: undefined,
  retryAttempt: undefined,
  retryStepId: undefined,
  retryStepName: undefined,
} as const;

export const CLEARED_LEASE = { workerId: undefined, leaseExpiresAt: undefined } as const;

export const UNFINISHED = { error: undefined, output: undefined, finishedAt: undefined } as const;
