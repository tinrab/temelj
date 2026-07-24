import type { RunId, WorkflowRunRecord } from "../../types/run.ts";
import type {
  WorkflowActiveChildWorkflowSummary,
  WorkflowStepAttemptRecord,
} from "../../types/step-attempts.ts";

import { sortedStringSet } from "../../collection.ts";
import {
  earliestOptionalTimestamp,
  shouldReplaceWorkflowEarliestDefinedInstant,
} from "../../temporal.ts";
import { StepId } from "../../types/step.ts";
import { summarizeChildWorkflowRuns } from "./child-workflow-runs.ts";
import {
  finishWorkflowStepAttemptActiveStartedSummary,
  finishWorkflowStepAttemptActiveTimeoutSummary,
} from "./step-attempt-active-fields.ts";

export interface WorkflowStepAttemptActiveChildWorkflowSummaryFields {
  readonly activeChildWorkflows?: WorkflowActiveChildWorkflowSummary;
}

export interface WorkflowStepAttemptActiveChildWorkflowSummaryReducer {
  addAttempt(attempt: WorkflowStepAttemptRecord, attemptKey: string): void;
  finish(
    childRuns?: readonly WorkflowRunRecord[],
  ): WorkflowStepAttemptActiveChildWorkflowSummaryFields;
}

interface WorkflowStepAttemptActiveChildWorkflowAccumulator {
  nextTimeoutAttemptKey?: string;
  nextTimeoutAt?: Temporal.Instant;
  nextTimeoutStepId?: StepId;
  oldestStartedAt?: Temporal.Instant;
  total: number;
  readonly attemptKeys: Set<string>;
  readonly childRunIds: Set<RunId>;
  readonly stepIds: Set<string>;
  readonly workflows: Set<string>;
}

export function createWorkflowStepAttemptActiveChildWorkflowSummaryReducer(): WorkflowStepAttemptActiveChildWorkflowSummaryReducer {
  const childWorkflow = createWorkflowStepAttemptActiveChildWorkflowAccumulator();
  return {
    addAttempt(attempt, attemptKey) {
      if (attempt.kind === "workflow" && attempt.status === "running") {
        addWorkflowStepAttemptActiveChildWorkflow(childWorkflow, attempt, attemptKey);
      }
    },
    finish(childRuns = []) {
      return finishWorkflowStepAttemptActiveChildWorkflowSummary(childWorkflow, childRuns);
    },
  };
}

function createWorkflowStepAttemptActiveChildWorkflowAccumulator(): WorkflowStepAttemptActiveChildWorkflowAccumulator {
  return {
    total: 0,
    attemptKeys: new Set<string>(),
    childRunIds: new Set<RunId>(),
    stepIds: new Set<string>(),
    workflows: new Set<string>(),
  };
}

function addWorkflowStepAttemptActiveChildWorkflow(
  childWorkflow: WorkflowStepAttemptActiveChildWorkflowAccumulator,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  childWorkflow.total++;
  childWorkflow.stepIds.add(attempt.stepId);
  childWorkflow.attemptKeys.add(attemptKey);
  childWorkflow.oldestStartedAt = earliestOptionalTimestamp(
    childWorkflow.oldestStartedAt,
    attempt.startedAt,
  );
  if (shouldReplaceWorkflowEarliestDefinedInstant(childWorkflow.nextTimeoutAt, attempt.timeoutAt)) {
    childWorkflow.nextTimeoutAt = attempt.timeoutAt;
    childWorkflow.nextTimeoutStepId = attempt.stepId;
    childWorkflow.nextTimeoutAttemptKey = attemptKey;
  }
  if (attempt.childRunId !== undefined) {
    childWorkflow.childRunIds.add(attempt.childRunId);
  }
  if (attempt.workflowName !== undefined) {
    childWorkflow.workflows.add(
      attempt.workflowVersion === undefined
        ? attempt.workflowName
        : `${attempt.workflowName}@${attempt.workflowVersion}`,
    );
  }
}

function finishWorkflowStepAttemptActiveChildWorkflowSummary(
  childWorkflow: WorkflowStepAttemptActiveChildWorkflowAccumulator,
  childRuns: readonly WorkflowRunRecord[],
): WorkflowStepAttemptActiveChildWorkflowSummaryFields {
  return childWorkflow.total === 0
    ? {}
    : {
        activeChildWorkflows: {
          total: childWorkflow.total,
          stepIds: sortedStringSet(childWorkflow.stepIds),
          attemptKeys: sortedStringSet(childWorkflow.attemptKeys),
          childRunIds: sortedStringSet(childWorkflow.childRunIds),
          workflows: sortedStringSet(childWorkflow.workflows),
          ...summarizeChildWorkflowRuns(
            activeChildWorkflowRuns(childRuns, childWorkflow.childRunIds),
          ),
          ...finishWorkflowStepAttemptActiveStartedSummary(childWorkflow),
          ...finishWorkflowStepAttemptActiveTimeoutSummary(childWorkflow),
        },
      };
}

function activeChildWorkflowRuns(
  childRuns: readonly WorkflowRunRecord[],
  childRunIds: ReadonlySet<string>,
): readonly WorkflowRunRecord[] {
  return childRuns.filter((childRun) => childRunIds.has(childRun.id));
}
