import type { EventKind, EventRecord } from "./events.ts";
import type { AttributePatch, RunRecord } from "./run.ts";

export interface Timeline {
  readonly run: RunRecord;
  readonly entries: readonly TimelineEntry[];
}

/** What each durable event kind means on a timeline: the thing it belongs to and what happened. */
export interface TimelineClassification {
  readonly workflow_started: readonly ["workflow", "started"];
  readonly workflow_completed: readonly ["workflow", "completed"];
  readonly workflow_failed: readonly ["workflow", "failed"];
  readonly step_started: readonly ["step", "started"];
  readonly step_completed: readonly ["step", "completed"];
  readonly step_failed: readonly ["step", "failed"];
  readonly metadata_set: readonly ["metadata", "set"];
  readonly attributes_set: readonly ["attributes", "set"];
  readonly deterministic_value_recorded: readonly ["deterministic", "recorded"];
  readonly sleep_started: readonly ["sleep", "started"];
  readonly sleep_completed: readonly ["sleep", "completed"];
  readonly child_workflow_started: readonly ["child_workflow", "started"];
  readonly child_workflow_completed: readonly ["child_workflow", "completed"];
  readonly child_workflow_failed: readonly ["child_workflow", "failed"];
  readonly message_send_started: readonly ["message", "send_started"];
  readonly message_send_completed: readonly ["message", "send_completed"];
  readonly message_send_failed: readonly ["message", "send_failed"];
  readonly message_sent: readonly ["message", "sent"];
  readonly message_wait_started: readonly ["message", "waiting"];
  readonly message_wait_completed: readonly ["message", "received"];
  readonly message_wait_failed: readonly ["message", "failed"];
  readonly stream_started: readonly ["stream", "started"];
  readonly stream_chunk: readonly ["stream", "chunk"];
  readonly stream_closed: readonly ["stream", "closed"];
  readonly stream_failed: readonly ["stream", "failed"];
}

/**
 * One durable event on a run's timeline, classified by `kind` and `status`. The event itself holds
 * the details; attribute entries also carry the patch the event applied.
 */
export type TimelineEntry = {
  readonly [Kind in EventKind]: {
    readonly kind: TimelineClassification[Kind][0];
    readonly status: TimelineClassification[Kind][1];
    readonly timestamp: Temporal.Instant;
    readonly event: Extract<EventRecord, { readonly kind: Kind }>;
  } & (Kind extends "attributes_set" ? { readonly attributes: AttributePatch } : unknown);
}[EventKind];
