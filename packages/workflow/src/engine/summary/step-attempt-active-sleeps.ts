import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";

import { optionalProperty, optionalSortedStringSetProperty } from "../../collection.ts";
import { shouldReplaceWorkflowEarliestDefinedInstant } from "../../temporal.ts";
import { StepId } from "../../types/step.ts";

export interface WorkflowStepAttemptActiveSleepSummaryFields {
  readonly activeSleepStepIds?: readonly string[];
  readonly activeSleepAttemptKeys?: readonly string[];
  readonly nextSleepUntil?: Temporal.Instant;
  readonly nextSleepStepId?: StepId;
  readonly nextSleepAttemptKey?: string;
  readonly nextSleepDuration?: Temporal.Duration;
}

export interface WorkflowStepAttemptActiveSleepSummaryReducer {
  addAttempt(attempt: WorkflowStepAttemptRecord, attemptKey: string): void;
  finish(): WorkflowStepAttemptActiveSleepSummaryFields;
}

interface WorkflowStepAttemptActiveSleepAccumulator {
  nextAttemptKey?: string;
  nextDuration?: Temporal.Duration;
  nextStepId?: StepId;
  nextUntil?: Temporal.Instant;
  readonly attemptKeys: Set<string>;
  readonly stepIds: Set<string>;
}

export function createWorkflowStepAttemptActiveSleepSummaryReducer(): WorkflowStepAttemptActiveSleepSummaryReducer {
  const sleep = createWorkflowStepAttemptActiveSleepAccumulator();
  return {
    addAttempt(attempt, attemptKey) {
      if (attempt.kind === "sleep" && attempt.status === "running") {
        addWorkflowStepAttemptActiveSleep(sleep, attempt, attemptKey);
      }
    },
    finish() {
      return finishWorkflowStepAttemptActiveSleepSummary(sleep);
    },
  };
}

function createWorkflowStepAttemptActiveSleepAccumulator(): WorkflowStepAttemptActiveSleepAccumulator {
  return {
    attemptKeys: new Set<string>(),
    stepIds: new Set<string>(),
  };
}

function addWorkflowStepAttemptActiveSleep(
  sleep: WorkflowStepAttemptActiveSleepAccumulator,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  sleep.stepIds.add(attempt.stepId);
  sleep.attemptKeys.add(attemptKey);
  if (shouldReplaceWorkflowEarliestDefinedInstant(sleep.nextUntil, attempt.until)) {
    sleep.nextUntil = attempt.until;
    sleep.nextStepId = attempt.stepId;
    sleep.nextAttemptKey = attemptKey;
    sleep.nextDuration =
      attempt.duration instanceof Temporal.Duration ? attempt.duration : undefined;
  }
}

function finishWorkflowStepAttemptActiveSleepSummary(
  sleep: WorkflowStepAttemptActiveSleepAccumulator,
): WorkflowStepAttemptActiveSleepSummaryFields {
  return {
    ...optionalSortedStringSetProperty("activeSleepStepIds", sleep.stepIds),
    ...optionalSortedStringSetProperty("activeSleepAttemptKeys", sleep.attemptKeys),
    ...(sleep.nextUntil === undefined
      ? {}
      : {
          nextSleepUntil: sleep.nextUntil,
          ...optionalProperty("nextSleepStepId", sleep.nextStepId),
          ...optionalProperty("nextSleepAttemptKey", sleep.nextAttemptKey),
          ...optionalProperty("nextSleepDuration", sleep.nextDuration),
        }),
  };
}
