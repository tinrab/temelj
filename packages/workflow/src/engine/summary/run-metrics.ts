import type {
  WorkflowRunRetryReason,
  WorkflowRunStatus,
  WorkflowRunTransitionReason,
  WorkflowTerminalRunStatus,
} from "../../types/run.ts";

export type WorkflowRunStatusCounts = Record<WorkflowRunStatus, number>;
export type WorkflowRunStatusRunIds = Record<WorkflowRunStatus, string[]>;
export type WorkflowRunTransitionReasonCounts = Record<WorkflowRunTransitionReason, number>;
export type WorkflowRunTransitionReasonRunIds = Record<WorkflowRunTransitionReason, string[]>;
export type WorkflowRunRetryReasonCounts = Record<WorkflowRunRetryReason, number>;
export type WorkflowTerminalRunStatusCounts = Record<WorkflowTerminalRunStatus, number>;
export type WorkflowTerminalRunStatusRunIds = Record<WorkflowTerminalRunStatus, string[]>;

const WORKFLOW_RUN_STATUSES = [
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "canceled",
] as const satisfies readonly WorkflowRunStatus[];

const WORKFLOW_TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "canceled",
] as const satisfies readonly WorkflowTerminalRunStatus[];

const WORKFLOW_RUN_TRANSITION_REASONS = [
  "created",
  "claimed",
  "reclaimed",
  "started",
  "waiting",
  "rescheduled",
  "lease_released",
  "manual_retry",
  "permanent_failure",
  "retry",
  "missing_implementation",
  "completed",
  "failed",
  "deadline",
  "canceled",
] as const satisfies readonly WorkflowRunTransitionReason[];

const WORKFLOW_RUN_RETRY_REASONS = [
  "workflow",
  "step",
  "missing_implementation",
] as const satisfies readonly WorkflowRunRetryReason[];

/** Creates a zero-filled count bucket for every workflow run status. */
export function createWorkflowRunStatusCounts(): WorkflowRunStatusCounts {
  return createCountBuckets(WORKFLOW_RUN_STATUSES);
}

/** Creates workflow run status run ids. */
export function createWorkflowRunStatusRunIds(): WorkflowRunStatusRunIds {
  return createRunIdBuckets(WORKFLOW_RUN_STATUSES);
}

/** Returns sorted run ID arrays for each workflow run status bucket. */
export function sortedWorkflowRunStatusRunIds(
  runIds: WorkflowRunStatusRunIds,
): Record<WorkflowRunStatus, readonly string[]> {
  return sortedRunIdBuckets(WORKFLOW_RUN_STATUSES, runIds);
}

/** Creates a zero-filled count bucket for every terminal workflow run status. */
export function createWorkflowTerminalRunStatusCounts(): WorkflowTerminalRunStatusCounts {
  return createCountBuckets(WORKFLOW_TERMINAL_RUN_STATUSES);
}

/** Creates empty run ID buckets for each terminal workflow run status. */
export function createWorkflowTerminalRunStatusRunIds(): WorkflowTerminalRunStatusRunIds {
  return createRunIdBuckets(WORKFLOW_TERMINAL_RUN_STATUSES);
}

/** Returns sorted run ID arrays for each terminal workflow run status bucket. */
export function sortedWorkflowTerminalRunStatusRunIds(
  runIds: WorkflowTerminalRunStatusRunIds,
): Record<WorkflowTerminalRunStatus, readonly string[]> {
  return sortedRunIdBuckets(WORKFLOW_TERMINAL_RUN_STATUSES, runIds);
}

/** Creates workflow run transition reason counts. */
export function createWorkflowRunTransitionReasonCounts(): WorkflowRunTransitionReasonCounts {
  return createCountBuckets(WORKFLOW_RUN_TRANSITION_REASONS);
}

/** Creates workflow run transition reason run ids. */
export function createWorkflowRunTransitionReasonRunIds(): WorkflowRunTransitionReasonRunIds {
  return createRunIdBuckets(WORKFLOW_RUN_TRANSITION_REASONS);
}

/** Returns sorted run ID arrays for each run transition reason bucket. */
export function sortedWorkflowRunTransitionReasonRunIds(
  runIds: WorkflowRunTransitionReasonRunIds,
): Record<WorkflowRunTransitionReason, readonly string[]> {
  return sortedRunIdBuckets(WORKFLOW_RUN_TRANSITION_REASONS, runIds);
}

/** Creates a zero-filled count bucket for every workflow retry reason. */
export function createWorkflowRunRetryReasonCounts(): WorkflowRunRetryReasonCounts {
  return createCountBuckets(WORKFLOW_RUN_RETRY_REASONS);
}

function createCountBuckets<const TKey extends string>(
  keys: readonly TKey[],
): Record<TKey, number> {
  const buckets = {} as Record<TKey, number>;
  for (const key of keys) {
    buckets[key] = 0;
  }
  return buckets;
}

function createRunIdBuckets<const TKey extends string>(
  keys: readonly TKey[],
): Record<TKey, string[]> {
  const buckets = {} as Record<TKey, string[]>;
  for (const key of keys) {
    buckets[key] = [];
  }
  return buckets;
}

function sortedRunIdBuckets<const TKey extends string>(
  keys: readonly TKey[],
  runIds: Record<TKey, readonly string[]>,
): Record<TKey, readonly string[]> {
  const buckets = {} as Record<TKey, readonly string[]>;
  for (const key of keys) {
    buckets[key] = [...runIds[key]].sort((left, right) => left.localeCompare(right));
  }
  return buckets;
}
