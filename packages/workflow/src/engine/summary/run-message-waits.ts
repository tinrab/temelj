import type { RunId } from "../../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { StepId } from "../../types/step.ts";
import type { WorkflowRunMessageSummary } from "../../types/summary.ts";

import { optionalProperty, sortedStringSet } from "../../collection.ts";
import {
  earliestOptionalTimestamp,
  shouldReplaceWorkflowEarliestDefinedInstant,
} from "../../temporal.ts";
import { makeWorkflowRunStepAttemptKey } from "../../utility.ts";

interface WorkflowRunMessageWaitSummary {
  readonly messageId?: WorkflowRunMessageSummary;
}

interface WorkflowRunMessageWaitAccumulator {
  nextAttemptKey?: string;
  nextRunId?: RunId;
  nextStepId?: StepId;
  nextTimeoutAt?: Temporal.Instant;
  oldestStartedAt?: Temporal.Instant;
  total: number;
  readonly attemptKeys: Set<string>;
  readonly messages: Set<string>;
  readonly runIds: Set<string>;
  readonly stepIds: Set<string>;
}

export function createWorkflowRunMessageWaitSummaryReducer(): {
  readonly addAttempt: (runId: RunId, attempt: WorkflowStepAttemptRecord) => void;
  readonly addAttempts: (runId: RunId, attempts: readonly WorkflowStepAttemptRecord[]) => void;
  readonly finish: () => WorkflowRunMessageWaitSummary;
} {
  const message = createWorkflowRunMessageWaitAccumulator();

  return {
    addAttempt(runId, attempt) {
      addWorkflowRunMessageWaitAttempt(message, runId, attempt);
    },
    addAttempts(runId, attempts) {
      for (const attempt of attempts) {
        addWorkflowRunMessageWaitAttempt(message, runId, attempt);
      }
    },
    finish() {
      return finishWorkflowRunMessageWaitSummary(message);
    },
  };
}

function createWorkflowRunMessageWaitAccumulator(): WorkflowRunMessageWaitAccumulator {
  return {
    total: 0,
    attemptKeys: new Set<string>(),
    messages: new Set<string>(),
    runIds: new Set<string>(),
    stepIds: new Set<string>(),
  };
}

function addWorkflowRunMessageWaitAttempt(
  message: WorkflowRunMessageWaitAccumulator,
  runId: RunId,
  attempt: WorkflowStepAttemptRecord,
): void {
  const attemptKey = makeWorkflowRunStepAttemptKey(runId, attempt);
  message.total++;
  message.runIds.add(runId);
  message.stepIds.add(attempt.stepId);
  message.attemptKeys.add(attemptKey);
  message.oldestStartedAt = earliestOptionalTimestamp(message.oldestStartedAt, attempt.startedAt);
  if (shouldReplaceWorkflowEarliestDefinedInstant(message.nextTimeoutAt, attempt.timeoutAt)) {
    setWorkflowRunMessageWaitNextTimeout(message, runId, attempt, attemptKey);
  }
  if (attempt.messageId !== undefined) {
    message.messages.add(attempt.messageId);
  }
}

function setWorkflowRunMessageWaitNextTimeout(
  message: WorkflowRunMessageWaitAccumulator,
  runId: RunId,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  message.nextTimeoutAt = attempt.timeoutAt;
  message.nextRunId = runId;
  message.nextStepId = attempt.stepId;
  message.nextAttemptKey = attemptKey;
}

function finishWorkflowRunMessageWaitSummary(
  message: WorkflowRunMessageWaitAccumulator,
): WorkflowRunMessageWaitSummary {
  return message.total === 0
    ? {}
    : {
        messageId: {
          activeWaits: message.total,
          activeWaitRuns: message.runIds.size,
          waitRunIds: sortedStringSet(message.runIds),
          waitStepIds: sortedStringSet(message.stepIds),
          waitAttemptKeys: sortedStringSet(message.attemptKeys),
          messages: sortedStringSet(message.messages),
          ...optionalProperty("oldestWaitStartedAt", message.oldestStartedAt),
          ...(message.nextTimeoutAt === undefined
            ? {}
            : {
                nextWaitTimeoutAt: message.nextTimeoutAt,
                ...optionalProperty("nextWaitTimeoutRunId", message.nextRunId),
                ...optionalProperty("nextWaitTimeoutStepId", message.nextStepId),
                ...optionalProperty("nextWaitTimeoutAttemptKey", message.nextAttemptKey),
              }),
        },
      };
}
