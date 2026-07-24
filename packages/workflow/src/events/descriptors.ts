import type { EventDescriptor, EventKind, EventRecord } from "../types/events.ts";

import { makeWorkflowStepAttemptKey } from "../history/attempt-key.ts";
import { StepId } from "../types/step.ts";

export type { EventDescriptor } from "../types/events.ts";

type EventRecordFor<Kind extends EventKind> = Extract<EventRecord, { readonly kind: Kind }>;
type EventField<Kind extends EventKind> = Extract<keyof EventRecordFor<Kind>, string>;
type SharedEventField<Left extends EventKind, Right extends EventKind> = Extract<
  keyof EventRecordFor<Left> & keyof EventRecordFor<Right>,
  string
>;

type EventDescriptorStartedEvent<Kind extends EventKind> =
  | {
      readonly startedEventType?: never;
      readonly startedEventMatchFields?: never;
    }
  | {
      readonly [StartedKind in EventKind]: {
        readonly startedEventType: StartedKind;
        readonly startedEventMatchFields: readonly SharedEventField<Kind, StartedKind>[];
      };
    }[EventKind];

type CheckedEventDescriptor<Kind extends EventKind> = Omit<
  EventDescriptor,
  | "kind"
  | "startedEventType"
  | "startedEventMatchFields"
  | "identityFields"
  | "valueIdentityFields"
  | "stringListIdentityFields"
> & {
  readonly kind: Kind;
  readonly identityFields?: readonly EventField<Kind>[];
  readonly valueIdentityFields?: readonly EventField<Kind>[];
  readonly stringListIdentityFields?: readonly EventField<Kind>[];
} & EventDescriptorStartedEvent<Kind>;

function defineEventDescriptors<
  const Descriptors extends {
    readonly [Kind in EventKind]: CheckedEventDescriptor<Kind>;
  },
>(descriptors: Descriptors): Descriptors {
  return descriptors;
}

// Descriptors are the central event metadata table.
// Cleanup, idempotency, reconciliation, and materialized step-attempt keys all read these fields instead of duplicating per-event rules.
export const WORKFLOW_EVENT_DESCRIPTORS = defineEventDescriptors({
  workflow_started: {
    kind: "workflow_started",
    category: "workflow",
    cleanup: true,
    identityFields: [],
  },
  workflow_completed: {
    kind: "workflow_completed",
    category: "workflow",
    cleanup: true,
    identityFields: [],
  },
  workflow_failed: {
    kind: "workflow_failed",
    category: "workflow",
    cleanup: true,
    identityFields: [],
  },
  step_started: {
    kind: "step_started",
    category: "step",
    cleanup: true,
    stepType: "run",
    stepAttempt: "event",
    identityFields: ["stepId", "stepName", "count", "attempt"],
  },
  step_completed: {
    kind: "step_completed",
    category: "step",
    cleanup: true,
    stepType: "run",
    stepAttempt: "event",
    terminalStepAttempt: true,
    startedEventType: "step_started",
    startedEventMatchFields: ["stepId", "stepName", "attempt"],
    identityFields: ["stepId", "stepName", "attempt"],
  },
  step_failed: {
    kind: "step_failed",
    category: "step",
    cleanup: true,
    stepType: "run",
    stepAttempt: "event",
    terminalStepAttempt: true,
    startedEventType: "step_started",
    startedEventMatchFields: ["stepId", "stepName", "attempt"],
    identityFields: ["stepId", "stepName", "attempt"],
  },
  sleep_started: {
    kind: "sleep_started",
    category: "sleep",
    cleanup: true,
    stepType: "sleep",
    stepAttempt: "single",
    identityFields: ["stepId", "stepName", "count", "until"],
  },
  sleep_completed: {
    kind: "sleep_completed",
    category: "sleep",
    cleanup: true,
    stepType: "sleep",
    stepAttempt: "single",
    terminalStepAttempt: true,
    startedEventType: "sleep_started",
    startedEventMatchFields: ["stepId", "stepName"],
    identityFields: ["stepId", "stepName"],
  },
  child_workflow_started: {
    kind: "child_workflow_started",
    category: "child_workflow",
    cleanup: true,
    stepType: "workflow",
    stepAttempt: "event",
    identityFields: ["stepId", "stepName", "count", "attempt", "childRunId", "cancellation"],
  },
  child_workflow_completed: {
    kind: "child_workflow_completed",
    category: "child_workflow",
    cleanup: true,
    stepType: "workflow",
    stepAttempt: "event",
    terminalStepAttempt: true,
    startedEventType: "child_workflow_started",
    startedEventMatchFields: ["stepId", "stepName", "attempt", "childRunId"],
    identityFields: ["stepId", "stepName", "attempt", "childRunId"],
  },
  child_workflow_failed: {
    kind: "child_workflow_failed",
    category: "child_workflow",
    cleanup: true,
    stepType: "workflow",
    stepAttempt: "event",
    terminalStepAttempt: true,
    startedEventType: "child_workflow_started",
    startedEventMatchFields: ["stepId", "stepName", "attempt", "childRunId"],
    identityFields: ["stepId", "stepName", "attempt", "childRunId"],
  },
  message_sent: {
    kind: "message_sent",
    category: "message",
    cleanup: true,
    identityFields: ["messageId", "idempotencyKey"],
    valueIdentityFields: ["payload"],
    stringListIdentityFields: ["waiterStepIds"],
  },
  message_send_started: {
    kind: "message_send_started",
    category: "message",
    cleanup: true,
    stepType: "message-send",
    stepAttempt: "single",
    identityFields: ["stepId", "stepName", "count", "targetRunId", "messageId"],
  },
  message_send_completed: {
    kind: "message_send_completed",
    category: "message",
    cleanup: true,
    stepType: "message-send",
    stepAttempt: "single",
    terminalStepAttempt: true,
    startedEventType: "message_send_started",
    startedEventMatchFields: ["stepId", "stepName", "targetRunId", "messageId"],
    identityFields: ["stepId", "stepName", "targetRunId", "messageId"],
  },
  message_send_failed: {
    kind: "message_send_failed",
    category: "message",
    cleanup: true,
    stepType: "message-send",
    stepAttempt: "single",
    terminalStepAttempt: true,
    startedEventType: "message_send_started",
    startedEventMatchFields: ["stepId", "stepName", "targetRunId", "messageId"],
    identityFields: ["stepId", "stepName", "targetRunId", "messageId"],
  },
  message_wait_started: {
    kind: "message_wait_started",
    category: "message",
    cleanup: true,
    stepType: "message-wait",
    stepAttempt: "single",
    identityFields: ["stepId", "stepName", "count", "messageId"],
  },
  message_wait_completed: {
    kind: "message_wait_completed",
    category: "message",
    cleanup: true,
    stepType: "message-wait",
    stepAttempt: "single",
    terminalStepAttempt: true,
    startedEventType: "message_wait_started",
    startedEventMatchFields: ["stepId", "stepName", "messageId"],
    identityFields: ["stepId", "stepName", "messageId", "messageTimestamp"],
  },
  message_wait_failed: {
    kind: "message_wait_failed",
    category: "message",
    cleanup: true,
    stepType: "message-wait",
    stepAttempt: "single",
    terminalStepAttempt: true,
    startedEventType: "message_wait_started",
    startedEventMatchFields: ["stepId", "stepName", "messageId"],
    identityFields: ["stepId", "stepName", "messageId"],
  },
  stream_started: {
    kind: "stream_started",
    category: "stream",
    cleanup: true,
    stepType: "stream",
    stepAttempt: "single",
    identityFields: ["stepId", "stepName", "count", "streamId", "contentType"],
    valueIdentityFields: ["metadata"],
  },
  stream_chunk: {
    kind: "stream_chunk",
    category: "stream",
    cleanup: true,
    identityFields: ["stepId", "stepName", "streamId", "index"],
    valueIdentityFields: ["chunk"],
  },
  stream_closed: {
    kind: "stream_closed",
    category: "stream",
    cleanup: true,
    stepType: "stream",
    stepAttempt: "single",
    terminalStepAttempt: true,
    startedEventType: "stream_started",
    startedEventMatchFields: ["stepId", "stepName", "streamId"],
    identityFields: ["stepId", "stepName", "streamId"],
  },
  stream_failed: {
    kind: "stream_failed",
    category: "stream",
    cleanup: true,
    stepType: "stream",
    stepAttempt: "single",
    terminalStepAttempt: true,
    startedEventType: "stream_started",
    startedEventMatchFields: ["stepId", "stepName", "streamId"],
    identityFields: ["stepId", "stepName", "streamId"],
  },
  deterministic_value_recorded: {
    kind: "deterministic_value_recorded",
    category: "deterministic",
    cleanup: true,
    stepType: "deterministic",
    stepAttempt: "single",
    identityFields: ["stepId", "stepName", "count"],
    valueIdentityFields: ["value"],
  },
  metadata_set: {
    kind: "metadata_set",
    category: "metadata",
    cleanup: false,
    stepType: "metadata",
    identityFields: ["stepId", "stepName", "count"],
    valueIdentityFields: ["metadata"],
  },
  attributes_set: {
    kind: "attributes_set",
    category: "metadata",
    cleanup: false,
    stepType: "attributes",
    identityFields: ["stepId", "stepName", "count"],
    valueIdentityFields: ["attributes"],
  },
});

const WORKFLOW_EVENT_KINDS_FOR_CLEANUP = new Set<string>(
  Object.values(WORKFLOW_EVENT_DESCRIPTORS)
    .filter((descriptor) => descriptor.cleanup)
    .map((descriptor) => descriptor.kind),
);

const WORKFLOW_RECORDED_STEP_EVENT_KINDS = new Set<string>(
  (Object.values(WORKFLOW_EVENT_DESCRIPTORS) as readonly EventDescriptor[])
    .filter((descriptor) => descriptor.stepType !== undefined)
    .map((descriptor) => descriptor.kind),
);

const WORKFLOW_TERMINAL_STEP_EVENT_KINDS = new Set<string>(
  (Object.values(WORKFLOW_EVENT_DESCRIPTORS) as readonly EventDescriptor[])
    .filter((descriptor) => descriptor.terminalStepAttempt === true)
    .map((descriptor) => descriptor.kind),
);

export function isEventKindForCleanup(kind: string): kind is EventKind {
  return WORKFLOW_EVENT_KINDS_FOR_CLEANUP.has(kind);
}

export function isCleanupEventRecord(event: EventRecord): boolean {
  return isEventKindForCleanup(event.kind);
}

export function isWorkflowRecordedStepEventKind(kind: string): kind is EventKind {
  return WORKFLOW_RECORDED_STEP_EVENT_KINDS.has(kind);
}

export function isWorkflowTerminalStepAttemptEvent(
  event: EventRecord,
): event is EventRecord & { readonly stepId: StepId } {
  return WORKFLOW_TERMINAL_STEP_EVENT_KINDS.has(event.kind);
}

export function getWorkflowEventStepAttempt(event: EventRecord): number | undefined {
  const descriptor = getEventDescriptor(event.kind);
  // Some event families retry by explicit attempt number; sleep, message, stream, and
  // deterministic events are single-attempt steps and use attempt 1 for their materialized key.
  if (descriptor.stepAttempt === "single") {
    return 1;
  }
  if (descriptor.stepAttempt === "event" && "attempt" in event) {
    return event.attempt;
  }
  return undefined;
}

export function getWorkflowEventStepAttemptKey(event: EventRecord): string | undefined {
  if (!("stepId" in event)) {
    return undefined;
  }
  const attempt = getWorkflowEventStepAttempt(event);
  return attempt === undefined ? undefined : makeWorkflowStepAttemptKey(event.stepId, attempt);
}

export function getEventDescriptor(kind: EventKind): EventDescriptor {
  return WORKFLOW_EVENT_DESCRIPTORS[kind];
}
