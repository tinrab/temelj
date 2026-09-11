import type { EventRecord } from "../types/events.ts";
import type { WorkflowRunRecord } from "../types/run.ts";
import type { Timeline as TimelineContract, TimelineEntryRecord } from "../types/timeline.ts";

import { workflowAttributePatchFromEvent } from "../attributes.ts";
import { workflowEventRecordListSchema } from "../types/events.ts";

/** Creates workflow timeline. */
export function createTimeline(
  run: WorkflowRunRecord,
  events: readonly EventRecord[],
): TimelineContract {
  return new Timeline(run, events);
}

/** Timeline projection built from a run record and its durable event history. */
export class Timeline implements TimelineContract {
  /** @inheritdoc */
  readonly run: WorkflowRunRecord;
  /** @inheritdoc */
  readonly entries: readonly TimelineEntryRecord[];

  constructor(run: WorkflowRunRecord, events: readonly EventRecord[]) {
    const parsedEvents = workflowEventRecordListSchema.parse(events);
    this.run = run;
    this.entries = parsedEvents.map(toTimelineEntry);
  }
}

function toTimelineEntry(event: EventRecord): TimelineEntryRecord {
  switch (event.kind) {
    case "workflow_started":
      return {
        kind: "workflow",
        status: "started",
        timestamp: event.timestamp,
        event,
      };
    case "workflow_completed":
      return {
        kind: "workflow",
        status: "completed",
        timestamp: event.timestamp,
        event,
      };
    case "workflow_failed":
      return {
        kind: "workflow",
        status: "failed",
        timestamp: event.timestamp,
        event,
      };
    case "step_started":
      return {
        kind: "step",
        status: "started",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        attempt: event.attempt,
        count: event.count,
        event,
      };
    case "step_completed":
      return {
        kind: "step",
        status: "completed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        attempt: event.attempt,
        result: event.result,
        event,
      };
    case "step_failed":
      return {
        kind: "step",
        status: "failed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        attempt: event.attempt,
        error: event.error,
        event,
      };
    case "metadata_set":
      return {
        kind: "metadata",
        status: "set",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        count: event.count,
        metadata: event.metadata,
        event,
      };
    case "attributes_set":
      return {
        kind: "attributes",
        status: "set",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        count: event.count,
        attributes: workflowAttributePatchFromEvent(event),
        event,
      };
    case "deterministic_value_recorded":
      return {
        kind: "deterministic",
        status: "recorded",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        count: event.count,
        value: event.value,
        event,
      };
    case "sleep_started":
      const result1 = {
        kind: "sleep",
        status: "started",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        count: event.count,
        until: event.until,
      } satisfies Partial<TimelineEntryRecord>;

      if (event.duration !== undefined) {
        Object.assign(result1, { duration: event.duration } satisfies Partial<TimelineEntryRecord>);
      }

      const result2 = Object.assign(result1, { event } satisfies Partial<TimelineEntryRecord>);

      return result2;
    case "sleep_completed":
      return {
        kind: "sleep",
        status: "completed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        event,
      };
    case "child_workflow_started":
      const result3 = {
        kind: "child_workflow",
        status: "started",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        count: event.count,
        childRunId: event.childRunId,
        workflowName: event.workflowName,
      } satisfies Partial<TimelineEntryRecord>;

      if (event.workflowVersion !== undefined) {
        Object.assign(result3, {
          workflowVersion: event.workflowVersion,
        } satisfies Partial<TimelineEntryRecord>);
      }

      if (event.input !== undefined) {
        Object.assign(result3, { input: event.input } satisfies Partial<TimelineEntryRecord>);
      }

      if (event.timeoutAt !== undefined) {
        Object.assign(result3, {
          timeoutAt: event.timeoutAt,
        } satisfies Partial<TimelineEntryRecord>);
      }

      const result4 = Object.assign(result3, { event } satisfies Partial<TimelineEntryRecord>);

      return result4;
    case "child_workflow_completed":
      return {
        kind: "child_workflow",
        status: "completed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        childRunId: event.childRunId,
        result: event.result,
        event,
      };
    case "child_workflow_failed":
      return {
        kind: "child_workflow",
        status: "failed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        childRunId: event.childRunId,
        error: event.error,
        event,
      };
    case "message_send_started":
      const result5 = {
        kind: "message",
        status: "send_started",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        count: event.count,
        targetRunId: event.targetRunId,
        messageId: event.messageId,
      } satisfies Partial<TimelineEntryRecord>;

      if (event.payload !== undefined) {
        Object.assign(result5, { payload: event.payload } satisfies Partial<TimelineEntryRecord>);
      }

      const result6 = Object.assign(result5, { event } satisfies Partial<TimelineEntryRecord>);

      return result6;
    case "message_send_completed":
      return {
        kind: "message",
        status: "send_completed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        targetRunId: event.targetRunId,
        messageId: event.messageId,
        event,
      };
    case "message_send_failed":
      return {
        kind: "message",
        status: "send_failed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        targetRunId: event.targetRunId,
        messageId: event.messageId,
        error: event.error,
        event,
      };
    case "message_sent":
      return {
        kind: "message",
        status: "sent",
        timestamp: event.timestamp,
        messageId: event.messageId,
        payload: event.payload,
        waiterStepIds: event.waiterStepIds,
        event,
      };
    case "message_wait_started":
      const result7 = {
        kind: "message",
        status: "waiting",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        count: event.count,
        messageId: event.messageId,
      } satisfies Partial<TimelineEntryRecord>;

      if (event.timeoutAt !== undefined) {
        Object.assign(result7, {
          timeoutAt: event.timeoutAt,
        } satisfies Partial<TimelineEntryRecord>);
      }

      const result8 = Object.assign(result7, { event } satisfies Partial<TimelineEntryRecord>);

      return result8;
    case "message_wait_completed":
      return {
        kind: "message",
        status: "received",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        messageId: event.messageId,
        payload: event.payload,
        messageTimestamp: event.messageTimestamp,
        event,
      };
    case "message_wait_failed":
      return {
        kind: "message",
        status: "failed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        messageId: event.messageId,
        error: event.error,
        event,
      };
    case "stream_started":
      const result9 = {
        kind: "stream",
        status: "started",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        count: event.count,
        streamId: event.streamId,
      } satisfies Partial<TimelineEntryRecord>;

      if (event.contentType !== undefined) {
        Object.assign(result9, {
          contentType: event.contentType,
        } satisfies Partial<TimelineEntryRecord>);
      }

      if (event.metadata !== undefined) {
        Object.assign(result9, { metadata: event.metadata } satisfies Partial<TimelineEntryRecord>);
      }

      const result10 = Object.assign(result9, { event } satisfies Partial<TimelineEntryRecord>);

      return result10;
    case "stream_chunk":
      return {
        kind: "stream",
        status: "chunk",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        streamId: event.streamId,
        index: event.index,
        chunk: event.chunk,
        event,
      };
    case "stream_closed":
      return {
        kind: "stream",
        status: "closed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        streamId: event.streamId,
        event,
      };
    case "stream_failed":
      return {
        kind: "stream",
        status: "failed",
        timestamp: event.timestamp,
        stepId: event.stepId,
        stepName: event.stepName,
        streamId: event.streamId,
        error: event.error,
        event,
      };
  }
}
