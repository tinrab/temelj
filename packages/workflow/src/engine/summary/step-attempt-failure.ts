import type {
  WorkflowStepAttemptFailureErrorSummary,
  WorkflowStepAttemptFailureSummary,
  WorkflowStepAttemptRecord,
} from "../../types/step-attempts.ts";

import { latestOptionalTimestamp } from "../../temporal.ts";

export interface WorkflowStepAttemptFailureSummaryFields {
  readonly failure?: WorkflowStepAttemptFailureSummary;
}

export interface WorkflowStepAttemptFailureSummaryReducer {
  addAttempt(attempt: WorkflowStepAttemptRecord, attemptKey: string): void;
  finish(): WorkflowStepAttemptFailureSummaryFields;
}

interface WorkflowStepAttemptFailureAccumulator {
  total: number;
  latestFailedAt?: Temporal.Instant;
  readonly errors: Map<string, WorkflowStepAttemptFailureErrorAccumulator>;
  readonly failedAttemptKeys: Set<string>;
  readonly failedStepIds: Set<string>;
}

interface WorkflowStepAttemptFailureErrorAccumulator {
  count: number;
  latestFailedAt?: Temporal.Instant;
  readonly failedAttemptKeys: Set<string>;
  readonly failedStepIds: Set<string>;
}

export function createWorkflowStepAttemptFailureSummaryReducer(): WorkflowStepAttemptFailureSummaryReducer {
  const failure = createWorkflowStepAttemptFailureAccumulator();
  return {
    addAttempt(attempt, attemptKey) {
      if (attempt.status === "failed") {
        addWorkflowStepAttemptFailure(failure, attempt, attemptKey);
      }
    },
    finish() {
      return finishWorkflowStepAttemptFailureSummary(failure);
    },
  };
}

function createWorkflowStepAttemptFailureAccumulator(): WorkflowStepAttemptFailureAccumulator {
  return {
    total: 0,
    errors: new Map<string, WorkflowStepAttemptFailureErrorAccumulator>(),
    failedAttemptKeys: new Set<string>(),
    failedStepIds: new Set<string>(),
  };
}

function addWorkflowStepAttemptFailure(
  failure: WorkflowStepAttemptFailureAccumulator,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  failure.total++;
  failure.failedStepIds.add(attempt.stepId);
  failure.failedAttemptKeys.add(attemptKey);
  failure.latestFailedAt = latestOptionalTimestamp(failure.latestFailedAt, attempt.finishedAt);
  addWorkflowStepAttemptFailureError(failure, attempt, attemptKey);
}

function addWorkflowStepAttemptFailureError(
  failure: WorkflowStepAttemptFailureAccumulator,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  const errorName = attempt.error?.name ?? "Error";
  const current = failure.errors.get(errorName) ?? {
    count: 0,
    failedAttemptKeys: new Set<string>(),
    failedStepIds: new Set<string>(),
  };
  current.count++;
  current.failedStepIds.add(attempt.stepId);
  current.failedAttemptKeys.add(attemptKey);
  current.latestFailedAt = latestOptionalTimestamp(current.latestFailedAt, attempt.finishedAt);
  failure.errors.set(errorName, current);
}

function finishWorkflowStepAttemptFailureSummary(
  failure: WorkflowStepAttemptFailureAccumulator,
): WorkflowStepAttemptFailureSummaryFields {
  return failure.total === 0
    ? {}
    : {
        failure: {
          total: failure.total,
          failedStepIds: [...failure.failedStepIds].sort(),
          failedAttemptKeys: [...failure.failedAttemptKeys].sort(),
          errors: finishWorkflowStepAttemptFailureErrors(failure.errors),
          ...(failure.latestFailedAt === undefined
            ? {}
            : { latestFailedAt: failure.latestFailedAt }),
        },
      };
}

function finishWorkflowStepAttemptFailureErrors(
  errors: ReadonlyMap<string, WorkflowStepAttemptFailureErrorAccumulator>,
): WorkflowStepAttemptFailureErrorSummary[] {
  return [...errors.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, summary]) => ({
      name,
      count: summary.count,
      failedStepIds: [...summary.failedStepIds].sort(),
      failedAttemptKeys: [...summary.failedAttemptKeys].sort(),
      ...(summary.latestFailedAt === undefined ? {} : { latestFailedAt: summary.latestFailedAt }),
    }));
}
