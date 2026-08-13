import "temporal-polyfill/global";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { WorkflowResolvedMissingImplementationRetryConfig } from "../types/retry.ts";
import type { WorkflowRunRecord } from "../types/run.ts";

import { WorkflowOptionsError } from "../errors/base.ts";
import { WorkflowImplementationNotFoundError } from "../errors/implementation.ts";
import { WorkflowRunDeadlineExceededError } from "../errors/run.ts";
import { durationTotal, isPositiveSafeInteger, safeDuration } from "../utility.ts";

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

export function toWorkflowWorkerErrorRecord(error: unknown): WorkflowErrorRecord {
  if (!(error instanceof Error)) {
    return {
      name: "WorkflowNonErrorThrow",
      message: String(error),
    };
  }
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(error instanceof WorkflowRunDeadlineExceededError
      ? {
          details: {
            runId: error.runId,
            deadlineAt: error.deadlineAt.toString(),
          },
        }
      : {}),
    ...(error instanceof WorkflowImplementationNotFoundError
      ? {
          details: {
            workflowName: error.workflowName,
            ...(error.workflowVersion === undefined
              ? {}
              : { workflowVersion: error.workflowVersion }),
          },
        }
      : {}),
  };
}
