import type { RunId, WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { StepId } from "../../types/step.ts";
import type { WorkflowRunChildWorkflowSummary } from "../../types/summary.ts";

import { optionalProperty, sortedStringSet } from "../../collection.ts";
import {
  earliestOptionalTimestamp,
  shouldReplaceWorkflowEarliestDefinedInstant,
} from "../../temporal.ts";
import { makeWorkflowRunStepAttemptKey } from "../../utility.ts";
import { summarizeChildWorkflowRuns } from "./child-workflow-runs.ts";

export interface WorkflowRunChildWorkflowWaitInput {
  readonly runId: RunId;
  readonly attempts: readonly WorkflowStepAttemptRecord[];
  readonly childRuns: readonly WorkflowRunRecord[];
}

interface WorkflowRunChildWorkflowWaitSummary {
  readonly childWorkflow?: WorkflowRunChildWorkflowSummary;
}

interface WorkflowRunChildWorkflowWaitAccumulator {
  nextTimeoutAttemptKey?: string;
  nextTimeoutAt?: Temporal.Instant;
  nextTimeoutRunId?: RunId;
  nextTimeoutStepId?: StepId;
  oldestStartedAt?: Temporal.Instant;
  total: number;
  readonly attemptKeys: Set<string>;
  readonly childRunIds: Set<string>;
  readonly childRunRecords: Map<string, WorkflowRunRecord>;
  readonly runIds: Set<string>;
  readonly stepIds: Set<string>;
  readonly workflows: Set<string>;
}

export interface WorkflowRunChildWorkflowWaitSummaryReducer {
  addChildWorkflowAttempts(
    runId: RunId,
    attempts: readonly WorkflowStepAttemptRecord[],
    childRuns: readonly WorkflowRunRecord[],
  ): void;
  finish(): WorkflowRunChildWorkflowWaitSummary;
}

/** Creates a reducer for active child workflow waits across workflow runs. */
export function createWorkflowRunChildWorkflowWaitSummaryReducer(): WorkflowRunChildWorkflowWaitSummaryReducer {
  const waits = createWorkflowRunChildWorkflowWaitAccumulator();

  return {
    addChildWorkflowAttempts(runId, attempts, childRuns) {
      for (const attempt of attempts) {
        addWorkflowRunChildWorkflowWaitAttempt(waits, runId, attempt);
      }
      for (const childRun of childRuns) {
        waits.childRunRecords.set(childRun.id, childRun);
      }
    },
    finish() {
      return finishWorkflowRunChildWorkflowWaitSummary(waits);
    },
  };
}

function createWorkflowRunChildWorkflowWaitAccumulator(): WorkflowRunChildWorkflowWaitAccumulator {
  return {
    total: 0,
    attemptKeys: new Set<string>(),
    childRunIds: new Set<string>(),
    childRunRecords: new Map<string, WorkflowRunRecord>(),
    runIds: new Set<string>(),
    stepIds: new Set<string>(),
    workflows: new Set<string>(),
  };
}

function addWorkflowRunChildWorkflowWaitAttempt(
  waits: WorkflowRunChildWorkflowWaitAccumulator,
  runId: RunId,
  attempt: WorkflowStepAttemptRecord,
): void {
  const attemptKey = makeWorkflowRunStepAttemptKey(runId, attempt);
  waits.total++;
  waits.runIds.add(runId);
  waits.stepIds.add(attempt.stepId);
  waits.attemptKeys.add(attemptKey);
  waits.oldestStartedAt = earliestOptionalTimestamp(waits.oldestStartedAt, attempt.startedAt);
  if (shouldReplaceWorkflowEarliestDefinedInstant(waits.nextTimeoutAt, attempt.timeoutAt)) {
    setWorkflowRunChildWorkflowWaitNextTimeout(waits, runId, attempt, attemptKey);
  }
  if (attempt.childRunId !== undefined) {
    waits.childRunIds.add(attempt.childRunId);
  }
  if (attempt.workflowName !== undefined) {
    waits.workflows.add(
      attempt.workflowVersion === undefined
        ? attempt.workflowName
        : `${attempt.workflowName}@${attempt.workflowVersion}`,
    );
  }
}

function setWorkflowRunChildWorkflowWaitNextTimeout(
  waits: WorkflowRunChildWorkflowWaitAccumulator,
  runId: RunId,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  waits.nextTimeoutAt = attempt.timeoutAt;
  waits.nextTimeoutRunId = runId;
  waits.nextTimeoutStepId = attempt.stepId;
  waits.nextTimeoutAttemptKey = attemptKey;
}

function finishWorkflowRunChildWorkflowWaitSummary(
  waits: WorkflowRunChildWorkflowWaitAccumulator,
): WorkflowRunChildWorkflowWaitSummary {
  return waits.total === 0
    ? {}
    : {
        childWorkflow: {
          activeWaits: waits.total,
          activeWaitRuns: waits.runIds.size,
          waitRunIds: sortedStringSet(waits.runIds),
          waitStepIds: sortedStringSet(waits.stepIds),
          waitAttemptKeys: sortedStringSet(waits.attemptKeys),
          childRunIds: sortedStringSet(waits.childRunIds),
          workflows: sortedStringSet(waits.workflows),
          ...summarizeChildWorkflowRuns([...waits.childRunRecords.values()]),
          ...optionalProperty("oldestWaitStartedAt", waits.oldestStartedAt),
          ...(waits.nextTimeoutAt === undefined
            ? {}
            : {
                nextWaitTimeoutAt: waits.nextTimeoutAt,
                ...optionalProperty("nextWaitTimeoutRunId", waits.nextTimeoutRunId),
                ...optionalProperty("nextWaitTimeoutStepId", waits.nextTimeoutStepId),
                ...optionalProperty("nextWaitTimeoutAttemptKey", waits.nextTimeoutAttemptKey),
              }),
        },
      };
}
