import type {
  WorkflowActiveMessageWaitSummary,
  WorkflowStepAttemptRecord,
} from "../../types/step-attempts.ts";

import { sortedStringSet } from "../../collection.ts";
import {
  earliestOptionalTimestamp,
  shouldReplaceWorkflowEarliestDefinedInstant,
} from "../../temporal.ts";
import { StepId } from "../../types/step.ts";
import {
  finishWorkflowStepAttemptActiveStartedSummary,
  finishWorkflowStepAttemptActiveTimeoutSummary,
} from "./step-attempt-active-fields.ts";

export interface WorkflowStepAttemptActiveMessageWaitSummaryFields {
  readonly activeMessageWaits?: WorkflowActiveMessageWaitSummary;
}

export interface WorkflowStepAttemptActiveMessageWaitSummaryReducer {
  addAttempt(attempt: WorkflowStepAttemptRecord, attemptKey: string): void;
  finish(): WorkflowStepAttemptActiveMessageWaitSummaryFields;
}

interface WorkflowStepAttemptActiveMessageWaitAccumulator {
  nextTimeoutAttemptKey?: string;
  nextTimeoutAt?: Temporal.Instant;
  nextTimeoutStepId?: StepId;
  oldestStartedAt?: Temporal.Instant;
  total: number;
  readonly attemptKeys: Set<string>;
  readonly messages: Set<string>;
  readonly stepIds: Set<string>;
}

export function createWorkflowStepAttemptActiveMessageWaitSummaryReducer(): WorkflowStepAttemptActiveMessageWaitSummaryReducer {
  const messageWait = createWorkflowStepAttemptActiveMessageWaitAccumulator();
  return {
    addAttempt(attempt, attemptKey) {
      if (attempt.kind === "message-wait" && attempt.status === "running") {
        addWorkflowStepAttemptActiveMessageWait(messageWait, attempt, attemptKey);
      }
    },
    finish() {
      return finishWorkflowStepAttemptActiveMessageWaitSummary(messageWait);
    },
  };
}

function createWorkflowStepAttemptActiveMessageWaitAccumulator(): WorkflowStepAttemptActiveMessageWaitAccumulator {
  return {
    total: 0,
    attemptKeys: new Set<string>(),
    messages: new Set<string>(),
    stepIds: new Set<string>(),
  };
}

function addWorkflowStepAttemptActiveMessageWait(
  messageWait: WorkflowStepAttemptActiveMessageWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  messageWait.total++;
  messageWait.stepIds.add(attempt.stepId);
  messageWait.attemptKeys.add(attemptKey);
  messageWait.oldestStartedAt = earliestOptionalTimestamp(
    messageWait.oldestStartedAt,
    attempt.startedAt,
  );
  if (shouldReplaceWorkflowEarliestDefinedInstant(messageWait.nextTimeoutAt, attempt.timeoutAt)) {
    messageWait.nextTimeoutAt = attempt.timeoutAt;
    messageWait.nextTimeoutStepId = attempt.stepId;
    messageWait.nextTimeoutAttemptKey = attemptKey;
  }
  if (attempt.messageId !== undefined) {
    messageWait.messages.add(attempt.messageId);
  }
}

function finishWorkflowStepAttemptActiveMessageWaitSummary(
  messageWait: WorkflowStepAttemptActiveMessageWaitAccumulator,
): WorkflowStepAttemptActiveMessageWaitSummaryFields {
  return messageWait.total === 0
    ? {}
    : {
        activeMessageWaits: {
          total: messageWait.total,
          stepIds: sortedStringSet(messageWait.stepIds),
          attemptKeys: sortedStringSet(messageWait.attemptKeys),
          messages: sortedStringSet(messageWait.messages),
          ...finishWorkflowStepAttemptActiveStartedSummary(messageWait),
          ...finishWorkflowStepAttemptActiveTimeoutSummary(messageWait),
        },
      };
}
