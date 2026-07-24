import type { EventKind, EventRecord } from "../types/events.ts";
import type { RunId, WorkflowMaterializedStepType } from "../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../types/step-attempts.ts";

import { WorkflowStateError } from "../errors/mod.ts";
import { getEventDescriptor } from "../events/descriptors.ts";
import { StepId } from "../types/step.ts";

export function applyWorkflowStepAttemptEvent(
  runId: RunId,
  event: EventRecord,
  current: WorkflowStepAttemptRecord | undefined,
): WorkflowStepAttemptRecord | undefined {
  // Projection is intentionally stateful for terminal events.
  // Completion/failure events only carry their outcome, so immutable fields such as timeout, input, and cancellation are copied from the matching started event when it is available.
  switch (event.kind) {
    case "step_started": {
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "run",
        status: "running",
        attempt: event.attempt,
        count: event.count,
        ...(event.timeoutAt === undefined ? {} : { timeoutAt: event.timeoutAt }),
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      };
    }
    case "step_completed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "run",
          event.attempt,
          event.timestamp,
        ),
        ...current,
        status: "completed",
        output: event.result,
        timeoutAt: current?.timeoutAt,
        finishedAt: event.timestamp,
      };
    }
    case "step_failed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "run",
          event.attempt,
          event.timestamp,
        ),
        ...current,
        status: "failed",
        error: event.error,
        timeoutAt: current?.timeoutAt,
        finishedAt: event.timestamp,
      };
    }
    case "sleep_started": {
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "sleep",
        status: "running",
        attempt: 1,
        count: event.count,
        until: event.until,
        ...(event.duration === undefined ? {} : { duration: event.duration }),
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      };
    }
    case "sleep_completed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "sleep",
          1,
          event.timestamp,
        ),
        ...current,
        status: "completed",
        until: current?.until,
        duration: current?.duration,
        finishedAt: event.timestamp,
      };
    }
    case "child_workflow_started": {
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "workflow",
        status: "running",
        attempt: event.attempt,
        count: event.count,
        childRunId: event.childRunId,
        workflowName: event.workflowName,
        ...(event.workflowVersion === undefined ? {} : { workflowVersion: event.workflowVersion }),
        ...(event.cancellation === undefined ? {} : { cancellation: event.cancellation }),
        ...(event.input === undefined ? {} : { input: event.input }),
        ...(event.timeoutAt === undefined ? {} : { timeoutAt: event.timeoutAt }),
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      };
    }
    case "child_workflow_completed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "workflow",
          event.attempt,
          event.timestamp,
        ),
        ...current,
        status: "completed",
        output: event.result,
        childRunId: event.childRunId,
        input: current?.input,
        cancellation: current?.cancellation,
        timeoutAt: current?.timeoutAt,
        finishedAt: event.timestamp,
      };
    }
    case "child_workflow_failed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "workflow",
          event.attempt,
          event.timestamp,
        ),
        ...current,
        status: "failed",
        error: event.error,
        childRunId: event.childRunId,
        input: current?.input,
        cancellation: current?.cancellation,
        timeoutAt: current?.timeoutAt,
        finishedAt: event.timestamp,
      };
    }
    case "message_send_started": {
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "message-send",
        status: "running",
        attempt: 1,
        count: event.count,
        targetRunId: event.targetRunId,
        messageId: event.messageId,
        ...(event.payload === undefined ? {} : { payload: event.payload }),
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      };
    }
    case "message_send_completed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "message-send",
          1,
          event.timestamp,
        ),
        ...current,
        status: "completed",
        targetRunId: event.targetRunId,
        messageId: event.messageId,
        payload: current?.payload,
        finishedAt: event.timestamp,
      };
    }
    case "message_send_failed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "message-send",
          1,
          event.timestamp,
        ),
        ...current,
        status: "failed",
        targetRunId: event.targetRunId,
        messageId: event.messageId,
        payload: current?.payload,
        error: event.error,
        finishedAt: event.timestamp,
      };
    }
    case "message_wait_started": {
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "message-wait",
        status: "running",
        attempt: 1,
        count: event.count,
        messageId: event.messageId,
        ...(event.timeoutAt === undefined ? {} : { timeoutAt: event.timeoutAt }),
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      };
    }
    case "message_wait_completed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "message-wait",
          1,
          event.timestamp,
        ),
        ...current,
        status: "completed",
        output: event.payload,
        messageId: event.messageId,
        messageTimestamp: event.messageTimestamp,
        finishedAt: event.timestamp,
      };
    }
    case "message_wait_failed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        ...makeBaseProjectedStepAttempt(
          runId,
          event.stepId,
          event.stepName,
          "message-wait",
          1,
          event.timestamp,
        ),
        ...current,
        status: "failed",
        messageId: event.messageId,
        error: event.error,
        finishedAt: event.timestamp,
      };
    }
    case "stream_started": {
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "stream",
        status: "running",
        attempt: 1,
        count: event.count,
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      };
    }
    case "stream_closed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "stream",
        status: "completed",
        attempt: 1,
        count: current?.count ?? 1,
        createdAt: current?.createdAt ?? event.timestamp,
        startedAt: current?.startedAt ?? event.timestamp,
        finishedAt: event.timestamp,
      };
    }
    case "stream_failed": {
      requireCurrentStepAttemptFieldsMatch(event, current);
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "stream",
        status: "failed",
        attempt: 1,
        count: current?.count ?? 1,
        error: event.error,
        createdAt: current?.createdAt ?? event.timestamp,
        startedAt: current?.startedAt ?? event.timestamp,
        finishedAt: event.timestamp,
      };
    }
    case "stream_chunk":
      return undefined;
    case "deterministic_value_recorded": {
      return {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "deterministic",
        status: "completed",
        attempt: 1,
        count: event.count,
        output: event.value,
        createdAt: event.timestamp,
        startedAt: event.timestamp,
        finishedAt: event.timestamp,
      };
    }
    case "message_sent":
      return undefined;
    case "workflow_started":
    case "workflow_completed":
    case "workflow_failed":
      return undefined;
  }
}

function requireCurrentStepAttemptFieldsMatch(
  event: EventRecord & Readonly<{ kind: EventKind; stepId: StepId }>,
  current: WorkflowStepAttemptRecord | undefined,
): void {
  // A missing current attempt is tolerated here so full-history reconciliation can ignore orphaned terminal events from partial histories.
  // When a current attempt exists, identity fields must still match the terminal event that is trying to update it.
  if (current === undefined) {
    return;
  }
  const descriptor = getEventDescriptor(event.kind);
  for (const field of descriptor.startedEventMatchFields ?? []) {
    if (field === "stepId") {
      continue;
    }
    const value = Reflect.get(event, field);
    if (Reflect.get(current, field) === undefined || Reflect.get(current, field) === value) {
      continue;
    }
    WorkflowStateError.stepAttemptFieldMismatch(event.stepId, field);
  }
}

function makeBaseProjectedStepAttempt(
  runId: RunId,
  stepId: StepId,
  stepName: string,
  kind: WorkflowMaterializedStepType,
  attempt: number,
  timestamp: Temporal.Instant,
): WorkflowStepAttemptRecord {
  return {
    runId,
    stepId,
    stepName,
    kind,
    status: "running",
    attempt,
    createdAt: timestamp,
    startedAt: timestamp,
  };
}
