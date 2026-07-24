import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";

import { earliestOptionalTimestamp, latestOptionalTimestamp } from "../../temporal.ts";

export interface WorkflowStepAttemptLifecycleSummaryFields {
  readonly oldestRunningAt?: Temporal.Instant;
  readonly latestFinishedAt?: Temporal.Instant;
}

export interface WorkflowStepAttemptLifecycleSummaryReducer {
  addAttempt(attempt: WorkflowStepAttemptRecord): void;
  finish(): WorkflowStepAttemptLifecycleSummaryFields;
}

interface WorkflowStepAttemptLifecycleAccumulator {
  latestFinishedAt?: Temporal.Instant;
  oldestRunningAt?: Temporal.Instant;
}

export function createWorkflowStepAttemptLifecycleSummaryReducer(): WorkflowStepAttemptLifecycleSummaryReducer {
  const lifecycle: WorkflowStepAttemptLifecycleAccumulator = {};
  return {
    addAttempt(attempt) {
      if (attempt.status === "running") {
        lifecycle.oldestRunningAt = earliestOptionalTimestamp(
          lifecycle.oldestRunningAt,
          attempt.startedAt,
        );
      }
      lifecycle.latestFinishedAt = latestOptionalTimestamp(
        lifecycle.latestFinishedAt,
        attempt.finishedAt,
      );
    },
    finish() {
      return {
        ...(lifecycle.oldestRunningAt === undefined
          ? {}
          : { oldestRunningAt: lifecycle.oldestRunningAt }),
        ...(lifecycle.latestFinishedAt === undefined
          ? {}
          : { latestFinishedAt: lifecycle.latestFinishedAt }),
      };
    },
  };
}
