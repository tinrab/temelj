import type { WorkflowRunRecord } from "../../types/run.ts";
import type {
  WorkflowRunFailureErrorSummary,
  WorkflowRunFailureSummary,
} from "../../types/summary.ts";

import { latestOptionalTimestamp } from "../../temporal.ts";

interface WorkflowRunFailureSummaryFields {
  readonly failure?: WorkflowRunFailureSummary;
}

interface WorkflowRunFailureAccumulator {
  total: number;
  latestFailedAt?: Temporal.Instant;
  readonly failedRunIds: Set<string>;
  readonly errors: Map<string, WorkflowRunFailureErrorAccumulator>;
}

interface WorkflowRunFailureErrorAccumulator {
  count: number;
  readonly failedRunIds: Set<string>;
  latestFailedAt?: Temporal.Instant;
}

export interface WorkflowRunFailureSummaryReducer {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunFailureSummaryFields;
}

/** Creates an accumulator for failed-run summary fields. */
export function createWorkflowRunFailureSummaryReducer(): WorkflowRunFailureSummaryReducer {
  const failure = createWorkflowRunFailureAccumulator();

  return {
    addRun(run) {
      if (run.status === "failed") {
        addWorkflowRunFailure(failure, run);
      }
    },
    finish() {
      return finishWorkflowRunFailureSummary(failure);
    },
  };
}

function createWorkflowRunFailureAccumulator(): WorkflowRunFailureAccumulator {
  return {
    total: 0,
    failedRunIds: new Set<string>(),
    errors: new Map<string, WorkflowRunFailureErrorAccumulator>(),
  };
}

function addWorkflowRunFailure(
  failure: WorkflowRunFailureAccumulator,
  run: WorkflowRunRecord,
): void {
  failure.total++;
  failure.failedRunIds.add(run.id);
  setWorkflowRunFailureLatestFailure(failure, run);
  addWorkflowRunFailureError(failure, run);
}

function setWorkflowRunFailureLatestFailure(
  failure: WorkflowRunFailureAccumulator,
  run: WorkflowRunRecord,
): void {
  failure.latestFailedAt = latestOptionalTimestamp(failure.latestFailedAt, run.finishedAt);
}

function addWorkflowRunFailureError(
  failure: WorkflowRunFailureAccumulator,
  run: WorkflowRunRecord,
): void {
  const errorName = run.error?.name ?? "Error";
  const current = failure.errors.get(errorName) ?? {
    count: 0,
    failedRunIds: new Set<string>(),
  };
  current.count++;
  current.failedRunIds.add(run.id);
  setWorkflowRunFailureErrorLatestFailure(current, run);
  failure.errors.set(errorName, current);
}

function setWorkflowRunFailureErrorLatestFailure(
  error: WorkflowRunFailureErrorAccumulator,
  run: WorkflowRunRecord,
): void {
  error.latestFailedAt = latestOptionalTimestamp(error.latestFailedAt, run.finishedAt);
}

function finishWorkflowRunFailureSummary(
  failure: WorkflowRunFailureAccumulator,
): WorkflowRunFailureSummaryFields {
  return failure.total === 0
    ? {}
    : {
        failure: {
          total: failure.total,
          failedRunIds: [...failure.failedRunIds].sort(),
          errors: finishWorkflowRunFailureErrors(failure.errors),
          ...(failure.latestFailedAt === undefined
            ? {}
            : { latestFailedAt: failure.latestFailedAt }),
        },
      };
}

function finishWorkflowRunFailureErrors(
  errors: ReadonlyMap<string, WorkflowRunFailureErrorAccumulator>,
): WorkflowRunFailureErrorSummary[] {
  return [...errors.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, summary]) => ({
      name,
      count: summary.count,
      failedRunIds: [...summary.failedRunIds].sort(),
      ...(summary.latestFailedAt === undefined ? {} : { latestFailedAt: summary.latestFailedAt }),
    }));
}
