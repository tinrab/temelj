import type { EventRecord } from "../../types/events.ts";

import { MessageId } from "../../types/message-id.ts";
import { StepId } from "../../types/step.ts";
import { StreamId } from "../../types/stream-id.ts";

export interface ActiveWorkflowStreamSummary {
  readonly stepId: StepId;
  readonly stepName: string;
  readonly streamId: StreamId;
  readonly startedAt: Temporal.Instant;
  readonly chunkCount: number;
}

export interface ActiveWorkflowHookSummary {
  readonly stepId: StepId;
  readonly name: string;
  readonly messageId: MessageId;
  readonly source: "hook" | "webhook";
  readonly startedAt: Temporal.Instant;
  readonly timeoutAt?: Temporal.Instant;
}

export interface ActiveWorkflowEventSummary {
  readonly streams: readonly ActiveWorkflowStreamSummary[];
  readonly hooks: readonly ActiveWorkflowHookSummary[];
}

export interface ActiveWorkflowEventSummaryReducer {
  addEvent(event: EventRecord): void;
  finish(): ActiveWorkflowEventSummary;
}

/** Creates a reducer for active stream and hook events within a single workflow run. */
export function createActiveWorkflowEventSummaryReducer(): ActiveWorkflowEventSummaryReducer {
  const streams = new Map<string, ActiveWorkflowStreamSummary>();
  const terminalStreamStepIds = new Set<string>();
  const hooks = new Map<string, ActiveWorkflowHookSummary>();
  const terminalHookStepIds = new Set<string>();

  return {
    addEvent(event) {
      addActiveStreamEvent(streams, terminalStreamStepIds, event);
      addActiveHookEvent(hooks, terminalHookStepIds, event);
    },
    finish() {
      return {
        streams: [...streams.values()].filter((stream) =>
          isActiveStream(stream, terminalStreamStepIds),
        ),
        hooks: [...hooks.values()].filter((hook) => isActiveHook(hook, terminalHookStepIds)),
      };
    },
  };
}

export function activeWorkflowEvents(events: readonly EventRecord[]): ActiveWorkflowEventSummary {
  const reducer = createActiveWorkflowEventSummaryReducer();
  for (const event of events) {
    reducer.addEvent(event);
  }
  return reducer.finish();
}

function addActiveStreamEvent(
  streams: Map<string, ActiveWorkflowStreamSummary>,
  terminalStreamStepIds: Set<string>,
  event: EventRecord,
): void {
  if (event.kind === "stream_started") {
    streams.set(event.stepId, {
      stepId: event.stepId,
      stepName: event.stepName,
      streamId: event.streamId,
      startedAt: event.timestamp,
      chunkCount: 0,
    });
    return;
  }
  if (event.kind === "stream_chunk") {
    const stream = streams.get(event.stepId);
    if (stream !== undefined) {
      streams.set(event.stepId, {
        ...stream,
        chunkCount: stream.chunkCount + 1,
      });
    }
    return;
  }
  if (event.kind === "stream_closed" || event.kind === "stream_failed") {
    terminalStreamStepIds.add(event.stepId);
  }
}

function isActiveStream(
  stream: ActiveWorkflowStreamSummary,
  terminalStreamStepIds: ReadonlySet<string>,
): boolean {
  return !terminalStreamStepIds.has(stream.stepId);
}

function addActiveHookEvent(
  hooks: Map<string, ActiveWorkflowHookSummary>,
  terminalHookStepIds: Set<string>,
  event: EventRecord,
): void {
  if (event.kind === "message_wait_started") {
    if (event.source !== "hook" && event.source !== "webhook") {
      return;
    }
    hooks.set(event.stepId, {
      stepId: event.stepId,
      name: event.stepName,
      messageId: event.messageId,
      source: event.source,
      startedAt: event.timestamp,
      ...(event.timeoutAt === undefined ? {} : { timeoutAt: event.timeoutAt }),
    });
    return;
  }
  if (event.kind === "message_wait_completed" || event.kind === "message_wait_failed") {
    terminalHookStepIds.add(event.stepId);
  }
}

function isActiveHook(
  hook: ActiveWorkflowHookSummary,
  terminalHookStepIds: ReadonlySet<string>,
): boolean {
  return !terminalHookStepIds.has(hook.stepId);
}
