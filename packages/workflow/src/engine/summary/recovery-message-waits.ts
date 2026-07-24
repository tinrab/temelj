import type { EventRecord } from "../../types/events.ts";
import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { WorkflowRecoveryMessageWaitSummary } from "../../types/summary.ts";
import type { WorkflowRecoveryTimestamp } from "./recovery-run-timestamps.ts";

import { WorkflowHistory } from "../../history/mod.ts";
import { earliestWorkflowRecoveryTimestamp } from "./recovery-run-timestamps.ts";

interface WorkflowMessageWaitAccumulator {
  readonly runIds: Set<string>;
  readonly readyRunIds: Set<string>;
  readonly timedOutRunIds: Set<string>;
  readonly readyStepIds: Set<string>;
  readonly timedOutStepIds: Set<string>;
  readonly messageIds: Set<string>;
  nextTimeout?: WorkflowRecoveryTimestamp;
}

export interface WorkflowRecoveryMessageWaitSummaryReducer {
  addAttempts(attempts: readonly WorkflowStepAttemptRecord[]): void;
  finish(): WorkflowRecoveryMessageWaitSummary;
}

export function createWorkflowRecoveryMessageWaitSummaryReducer(
  eventsByRunId: ReadonlyMap<string, readonly EventRecord[]>,
  now: Temporal.Instant,
): WorkflowRecoveryMessageWaitSummaryReducer {
  const message = createMessageWaitAccumulator();
  const historiesByRunId = workflowHistoriesByRunId(eventsByRunId);

  return {
    addAttempts(attempts) {
      for (const attempt of attempts) {
        addMessageWaitAttempt(message, attempt, historiesByRunId, now);
      }
    },
    finish() {
      return finishMessageWaitSummary(message);
    },
  };
}

function createMessageWaitAccumulator(): WorkflowMessageWaitAccumulator {
  return {
    runIds: new Set<string>(),
    readyRunIds: new Set<string>(),
    timedOutRunIds: new Set<string>(),
    readyStepIds: new Set<string>(),
    timedOutStepIds: new Set<string>(),
    messageIds: new Set<string>(),
  };
}

function addMessageWaitAttempt(
  message: WorkflowMessageWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
  historiesByRunId: ReadonlyMap<string, WorkflowHistory>,
  now: Temporal.Instant,
): void {
  if (attempt.status !== "running" || attempt.kind !== "message-wait") {
    return;
  }
  message.runIds.add(attempt.runId);
  const ready = addReadyMessageWaitAttempt(message, attempt, historiesByRunId);
  if (!ready) {
    addTimedOutMessageWaitAttempt(message, attempt, now);
  }
}

function addReadyMessageWaitAttempt(
  message: WorkflowMessageWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
  historiesByRunId: ReadonlyMap<string, WorkflowHistory>,
): boolean {
  if (attempt.messageId === undefined) {
    return false;
  }
  message.messageIds.add(attempt.messageId);
  // A message wait is ready only when the message was recorded after the wait started.
  // Targeted messages also have to name this waiter in waiterStepIds.
  if (!messageWasDeliveredForAttempt(historiesByRunId.get(attempt.runId), attempt)) {
    return false;
  }
  message.readyRunIds.add(attempt.runId);
  message.readyStepIds.add(attempt.stepId);
  return true;
}

function messageWasDeliveredForAttempt(
  history: WorkflowHistory | undefined,
  attempt: WorkflowStepAttemptRecord,
): boolean {
  return (
    history !== undefined &&
    attempt.messageId !== undefined &&
    history.messageForWait(attempt.messageId, attempt.stepId, attempt.timeoutAt) !== undefined
  );
}

function addTimedOutMessageWaitAttempt(
  message: WorkflowMessageWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
  now: Temporal.Instant,
): void {
  if (attempt.timeoutAt === undefined) {
    return;
  }
  if (Temporal.Instant.compare(attempt.timeoutAt, now) <= 0) {
    message.timedOutRunIds.add(attempt.runId);
    message.timedOutStepIds.add(attempt.stepId);
    return;
  }
  message.nextTimeout = earliestWorkflowRecoveryTimestamp(
    message.nextTimeout,
    attempt.runId,
    attempt.timeoutAt,
  );
}

function workflowHistoriesByRunId(
  eventsByRunId: ReadonlyMap<string, readonly EventRecord[]>,
): ReadonlyMap<string, WorkflowHistory> {
  const histories = new Map<string, WorkflowHistory>();
  for (const [runId, events] of eventsByRunId) {
    histories.set(runId, new WorkflowHistory(events));
  }
  return histories;
}

function finishMessageWaitSummary(
  message: WorkflowMessageWaitAccumulator,
): WorkflowRecoveryMessageWaitSummary {
  return {
    active: message.runIds.size,
    ready: message.readyRunIds.size,
    timedOut: message.timedOutRunIds.size,
    runIds: [...message.runIds].sort(),
    readyRunIds: [...message.readyRunIds].sort(),
    timedOutRunIds: [...message.timedOutRunIds].sort(),
    readyStepIds: [...message.readyStepIds].sort(),
    timedOutStepIds: [...message.timedOutStepIds].sort(),
    messages: [...message.messageIds].sort(),
    ...(message.nextTimeout === undefined
      ? {}
      : {
          nextTimeoutAt: message.nextTimeout.timestamp,
          nextTimeoutRunId: message.nextTimeout.runId,
        }),
  };
}
