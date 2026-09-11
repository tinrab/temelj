import type { EventFieldName, EventFieldValue, EventKind, EventRecord } from "../types/events.ts";
import type { RunId, WorkflowMaterializedStepType } from "../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../types/step-attempts.ts";

import { WorkflowStateError } from "../errors/mod.ts";
import { getEventDescriptor, getEventField } from "../events/descriptors.ts";
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
      const result1 = {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "run",
        status: "running",
        attempt: event.attempt,
        count: event.count,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>;

      if (event.timeoutAt !== undefined) {
        Object.assign(result1, { timeoutAt: event.timeoutAt } satisfies Partial<
          WorkflowStepAttemptRecord | undefined
        >);
      }

      const result2 = Object.assign(result1, {
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>);

      return result2;
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
      const result3 = {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "sleep",
        status: "running",
        attempt: 1,
        count: event.count,
        until: event.until,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>;

      if (event.duration !== undefined) {
        Object.assign(result3, { duration: event.duration } satisfies Partial<
          WorkflowStepAttemptRecord | undefined
        >);
      }

      const result4 = Object.assign(result3, {
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>);

      return result4;
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
      const result5 = {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "workflow",
        status: "running",
        attempt: event.attempt,
        count: event.count,
        childRunId: event.childRunId,
        workflowName: event.workflowName,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>;

      if (event.workflowVersion !== undefined) {
        Object.assign(result5, { workflowVersion: event.workflowVersion } satisfies Partial<
          WorkflowStepAttemptRecord | undefined
        >);
      }

      if (event.cancellation !== undefined) {
        Object.assign(result5, { cancellation: event.cancellation } satisfies Partial<
          WorkflowStepAttemptRecord | undefined
        >);
      }

      if (event.input !== undefined) {
        Object.assign(result5, { input: event.input } satisfies Partial<
          WorkflowStepAttemptRecord | undefined
        >);
      }

      if (event.timeoutAt !== undefined) {
        Object.assign(result5, { timeoutAt: event.timeoutAt } satisfies Partial<
          WorkflowStepAttemptRecord | undefined
        >);
      }

      const result6 = Object.assign(result5, {
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>);

      return result6;
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
      const result7 = {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "message-send",
        status: "running",
        attempt: 1,
        count: event.count,
        targetRunId: event.targetRunId,
        messageId: event.messageId,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>;

      if (event.payload !== undefined) {
        Object.assign(result7, { payload: event.payload } satisfies Partial<
          WorkflowStepAttemptRecord | undefined
        >);
      }

      const result8 = Object.assign(result7, {
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>);

      return result8;
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
      const result9 = {
        runId,
        stepId: event.stepId,
        stepName: event.stepName,
        kind: "message-wait",
        status: "running",
        attempt: 1,
        count: event.count,
        messageId: event.messageId,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>;

      if (event.timeoutAt !== undefined) {
        Object.assign(result9, { timeoutAt: event.timeoutAt } satisfies Partial<
          WorkflowStepAttemptRecord | undefined
        >);
      }

      const result10 = Object.assign(result9, {
        createdAt: event.timestamp,
        startedAt: event.timestamp,
      } satisfies Partial<WorkflowStepAttemptRecord | undefined>);

      return result10;
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
  const currentFields: Partial<Record<EventFieldName, EventFieldValue>> = current;

  for (const field of descriptor.startedEventMatchFields ?? []) {
    if (field === "stepId") {
      continue;
    }

    const value = getEventField(event, field);

    if (currentFields[field] === undefined || currentFields[field] === value) {
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
