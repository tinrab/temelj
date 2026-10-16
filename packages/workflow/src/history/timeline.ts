import type { EventRecord } from "../types/events.ts";
import type { RunRecord } from "../types/run.ts";
import type {
  Timeline as TimelineContract,
  TimelineClassification,
  TimelineEntry,
} from "../types/timeline.ts";

import { workflowAttributePatchFromEvent } from "../attributes.ts";
import { parse } from "../schema/common.ts";
import { eventRecordListSchema } from "../schema/events.ts";

const CLASSIFICATION: TimelineClassification = {
  workflow_started: ["workflow", "started"],
  workflow_completed: ["workflow", "completed"],
  workflow_failed: ["workflow", "failed"],
  step_started: ["step", "started"],
  step_completed: ["step", "completed"],
  step_failed: ["step", "failed"],
  metadata_set: ["metadata", "set"],
  attributes_set: ["attributes", "set"],
  deterministic_value_recorded: ["deterministic", "recorded"],
  sleep_started: ["sleep", "started"],
  sleep_completed: ["sleep", "completed"],
  child_workflow_started: ["child_workflow", "started"],
  child_workflow_completed: ["child_workflow", "completed"],
  child_workflow_failed: ["child_workflow", "failed"],
  message_send_started: ["message", "send_started"],
  message_send_completed: ["message", "send_completed"],
  message_send_failed: ["message", "send_failed"],
  message_sent: ["message", "sent"],
  message_wait_started: ["message", "waiting"],
  message_wait_completed: ["message", "received"],
  message_wait_failed: ["message", "failed"],
  stream_started: ["stream", "started"],
  stream_chunk: ["stream", "chunk"],
  stream_closed: ["stream", "closed"],
  stream_failed: ["stream", "failed"],
};

/** Timeline projection built from a run record and its durable event history. */
export function createTimeline(run: RunRecord, events: readonly EventRecord[]): TimelineContract {
  return { run, entries: parse(eventRecordListSchema, events).map(toTimelineEntry) };
}

function toTimelineEntry(event: EventRecord): TimelineEntry {
  const [kind, status] = CLASSIFICATION[event.kind];
  const entry = { kind, status, timestamp: event.timestamp, event };

  // SAFETY: The classification table is keyed by event kind and typed against TimelineEntry, so
  // each kind and status pair matches its event.
  return (
    event.kind === "attributes_set"
      ? { ...entry, attributes: workflowAttributePatchFromEvent(event) }
      : entry
  ) as TimelineEntry;
}
