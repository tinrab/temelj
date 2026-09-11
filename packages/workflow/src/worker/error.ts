import type { WorkflowImplementationErrorDetails } from "../types/error.ts";
import type { WorkflowErrorRecord } from "../types/error.ts";
import "temporal-polyfill/global";

import type { WorkflowResolvedMissingImplementationRetryConfig } from "../types/retry.ts";
import type { WorkflowRunRecord } from "../types/run.ts";

import { WorkflowOptionsError } from "../errors/base.ts";
import { WorkflowImplementationNotFoundError } from "../errors/implementation.ts";
import { WorkflowRunDeadlineExceededError } from "../errors/run.ts";
import { durationTotal } from "../temporal.ts";
import { isPositiveSafeInteger, safeDuration } from "../utility.ts";

export const DEFAULT_MISSING_IMPLEMENTATION_RETRY_INTERVAL = Temporal.Duration.from({
  seconds: 30,
});

export function makeMissingImplementationNotFoundErrorRecord(
  run: WorkflowRunRecord,
): WorkflowErrorRecord {
  return toWorkflowWorkerErrorRecord(
    WorkflowImplementationNotFoundError.create(run.workflowName, run.workflowVersion),
  );
}

export function makeMissingImplementationDeadlineErrorRecord(
  run: WorkflowRunRecord,
  deadlineAt: Temporal.Instant,
): WorkflowErrorRecord {
  return toWorkflowWorkerErrorRecord(WorkflowRunDeadlineExceededError.create(run.id, deadlineAt));
}

export function missingImplementationRetryDelay(
  retry: WorkflowResolvedMissingImplementationRetryConfig,
  retryAttempt: number,
): Temporal.Duration {
  if (!isPositiveSafeInteger(retryAttempt)) {
    WorkflowOptionsError.missingImplementationRetryAttemptPositiveSafeInteger();
  }

  const exponentialDelay =
    durationTotal(retry.initialInterval) *
    retry.backoffCoefficient ** Math.max(0, retryAttempt - 1);

  const delay =
    retry.maximumInterval === undefined
      ? exponentialDelay
      : Math.min(exponentialDelay, durationTotal(retry.maximumInterval));

  safeDuration(delay, "Workflow missing implementation retry delay");

  return Temporal.Duration.from({ milliseconds: delay });
}

export function toWorkflowWorkerErrorRecord(cause: unknown): WorkflowErrorRecord {
  if (!(cause instanceof Error)) {
    return {
      name: "WorkflowNonErrorThrow",
      message: String(cause),
    };
  }

  const summary: WorkflowErrorRecord = { name: cause.name, message: cause.message };

  if (cause.stack !== undefined) {
    Object.assign(summary, { stack: cause.stack } satisfies Partial<WorkflowErrorRecord>);
  }

  if (cause instanceof WorkflowRunDeadlineExceededError) {
    Object.assign(summary, {
      details: {
        runId: cause.runId,
        deadlineAt: cause.deadlineAt.toString(),
      },
    } satisfies Partial<WorkflowErrorRecord>);
  }

  if (cause instanceof WorkflowImplementationNotFoundError) {
    const details: WorkflowImplementationErrorDetails = {
      workflowName: cause.workflowName,
    };

    if (cause.workflowVersion !== undefined) details.workflowVersion = cause.workflowVersion;
    Object.assign(summary, { details } satisfies Partial<WorkflowErrorRecord>);
  }

  return summary;
}
