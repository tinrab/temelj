import type { RunId } from "../../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { StepId } from "../../types/step.ts";
import type { WorkflowRunSleepSummary } from "../../types/summary.ts";

import { optionalProperty, sortedStringSet } from "../../collection.ts";
import {
  earliestOptionalTimestamp,
  shouldReplaceWorkflowEarliestDefinedInstant,
} from "../../temporal.ts";
import { makeWorkflowRunStepAttemptKey } from "../../utility.ts";

interface WorkflowRunSleepWaitSummary {
  readonly sleep?: WorkflowRunSleepSummary;
}

interface WorkflowRunSleepWaitAccumulator {
  nextAttemptKey?: string;
  nextDuration?: Temporal.Duration;
  nextRunId?: RunId;
  nextStepId?: StepId;
  nextWakeAt?: Temporal.Instant;
  oldestStartedAt?: Temporal.Instant;
  total: number;
  readonly attemptKeys: Set<string>;
  readonly runIds: Set<string>;
  readonly stepIds: Set<string>;
}

export function createWorkflowRunSleepWaitSummaryReducer(): {
  readonly addAttempt: (runId: RunId, attempt: WorkflowStepAttemptRecord) => void;
  readonly addAttempts: (runId: RunId, attempts: readonly WorkflowStepAttemptRecord[]) => void;
  readonly finish: () => WorkflowRunSleepWaitSummary;
} {
  const sleep = createWorkflowRunSleepWaitAccumulator();

  return {
    addAttempt(runId, attempt) {
      addWorkflowRunSleepWaitAttempt(sleep, runId, attempt);
    },
    addAttempts(runId, attempts) {
      for (const attempt of attempts) {
        addWorkflowRunSleepWaitAttempt(sleep, runId, attempt);
      }
    },
    finish() {
      return finishWorkflowRunSleepWaitSummary(sleep);
    },
  };
}

function createWorkflowRunSleepWaitAccumulator(): WorkflowRunSleepWaitAccumulator {
  return {
    total: 0,
    attemptKeys: new Set<string>(),
    runIds: new Set<string>(),
    stepIds: new Set<string>(),
  };
}

function addWorkflowRunSleepWaitAttempt(
  sleep: WorkflowRunSleepWaitAccumulator,
  runId: RunId,
  attempt: WorkflowStepAttemptRecord,
): void {
  const attemptKey = makeWorkflowRunStepAttemptKey(runId, attempt);
  sleep.total++;
  sleep.runIds.add(runId);
  sleep.stepIds.add(attempt.stepId);
  sleep.attemptKeys.add(attemptKey);
  sleep.oldestStartedAt = earliestOptionalTimestamp(sleep.oldestStartedAt, attempt.startedAt);
  if (shouldReplaceWorkflowEarliestDefinedInstant(sleep.nextWakeAt, attempt.until)) {
    setWorkflowRunSleepWaitNextWake(sleep, runId, attempt, attemptKey);
  }
}

function setWorkflowRunSleepWaitNextWake(
  sleep: WorkflowRunSleepWaitAccumulator,
  runId: RunId,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  sleep.nextWakeAt = attempt.until;
  sleep.nextRunId = runId;
  sleep.nextStepId = attempt.stepId;
  sleep.nextAttemptKey = attemptKey;
  sleep.nextDuration = attempt.duration instanceof Temporal.Duration ? attempt.duration : undefined;
}

function finishWorkflowRunSleepWaitSummary(
  sleep: WorkflowRunSleepWaitAccumulator,
): WorkflowRunSleepWaitSummary {
  return sleep.total === 0
    ? {}
    : {
        sleep: {
          activeSleeps: sleep.total,
          activeSleepRuns: sleep.runIds.size,
          sleepRunIds: sortedStringSet(sleep.runIds),
          sleepStepIds: sortedStringSet(sleep.stepIds),
          sleepAttemptKeys: sortedStringSet(sleep.attemptKeys),
          ...optionalProperty("oldestStartedAt", sleep.oldestStartedAt),
          ...(sleep.nextWakeAt === undefined
            ? {}
            : {
                nextWakeAt: sleep.nextWakeAt,
                ...optionalProperty("nextWakingRunId", sleep.nextRunId),
                ...optionalProperty("nextWakingStepId", sleep.nextStepId),
                ...optionalProperty("nextWakingAttemptKey", sleep.nextAttemptKey),
                ...optionalProperty("nextWakingDuration", sleep.nextDuration),
              }),
        },
      };
}
