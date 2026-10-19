import type {
  EventRecord,
  EventFieldName,
  MessageWaitCompletedEvent,
  MessageWaitFailedEvent,
} from "../types/events.ts";
import type { StepType } from "../types/run.ts";

import { WorkflowReplayDivergenceError, WorkflowStateError } from "../errors/mod.ts";
import {
  getEventDescriptor,
  getWorkflowEventStepAttempt,
  isWorkflowTerminalStepAttemptEvent,
  eventFieldsMatch,
} from "../events/descriptors.ts";
import {
  isRecordedStepEvent,
  type RecordedStepEvent,
  workflowRecordedStepEventType,
} from "./sequencer.ts";

export function workflowStartedEventMatchesTerminalEvent(
  started: EventRecord,
  terminal: EventRecord,
): boolean {
  const descriptor = getEventDescriptor(terminal.kind);

  if (
    descriptor.terminalStepAttempt !== true ||
    descriptor.startedEventType === undefined ||
    started.kind !== descriptor.startedEventType ||
    !recordedAttemptFieldsMatch(started, terminal, descriptor.startedEventMatchFields)
  ) {
    return false;
  }

  return eventFieldsMatch(started, terminal, descriptor.startedEventMatchFields);
}

function workflowHistoryHasStartedEventBeforeTerminalEvent(
  events: readonly EventRecord[],
  event: EventRecord,
): boolean {
  const terminalIndex = events.indexOf(event);

  if (terminalIndex < 0 || !isWorkflowTerminalStepAttemptEvent(event)) {
    return false;
  }

  return events
    .slice(0, terminalIndex)
    .some((started) => workflowStartedEventMatchesTerminalEvent(started, event));
}

export function requireWorkflowTerminalEventsHaveStartedEvents(
  events: readonly EventRecord[],
): void {
  for (const event of events) {
    if (
      !isWorkflowTerminalStepAttemptEvent(event) ||
      workflowHistoryHasStartedEventBeforeTerminalEvent(events, event)
    ) {
      continue;
    }

    if (isStaleMessageWaitTerminalBeforeLaterStart(events, event)) {
      continue;
    }

    const stepId = terminalStepEventId(event);
    const type = terminalStepEventStepType(event);
    WorkflowReplayDivergenceError.atStep(
      stepId,
      `recorded ${type} step ${stepId} has a terminal event without a started event`,
    );
  }
}

export function requireWorkflowTerminalEventsAreUnique(events: readonly EventRecord[]): void {
  const terminals = new Map<string, EventRecord>();

  for (const event of events) {
    if (!isWorkflowTerminalStepAttemptEvent(event)) {
      continue;
    }

    const key = getTerminalStepAttemptIdentityKey(event);

    if (key === undefined) {
      continue;
    }

    const existing = terminals.get(key);

    if (existing === undefined) {
      terminals.set(key, event);
      continue;
    }

    const stepId = terminalStepEventId(event);
    const type = terminalStepEventStepType(event);
    WorkflowReplayDivergenceError.atStep(
      stepId,
      `recorded ${type} step ${stepId} has multiple terminal events for attempt ${getTerminalStepEventAttempt(event)}`,
    );
  }
}

export function requireWorkflowStartedEventsAreUnique(events: readonly EventRecord[]): void {
  const started = new Map<string, RecordedStepEvent>();

  for (const event of events) {
    if (!isRecordedStepEvent(event)) {
      continue;
    }

    const key = startedStepAttemptIdentityKey(event);

    if (key === undefined) {
      continue;
    }

    const existing = started.get(key);

    if (existing === undefined) {
      started.set(key, event);
      continue;
    }

    const type = workflowRecordedStepEventType(event);
    WorkflowReplayDivergenceError.atStep(
      event.stepId,
      `recorded ${type} step ${event.stepId} has multiple started events for attempt ${getWorkflowEventStepAttempt(event)}`,
    );
  }
}

function isValidRecordedAttempt(attempt: number | undefined): attempt is number {
  return attempt !== undefined && Number.isSafeInteger(attempt) && attempt > 0;
}

function recordedAttemptFieldsMatch(
  started: EventRecord,
  terminal: EventRecord,
  fields: readonly EventFieldName[] = [],
): boolean {
  if (!fields.includes("attempt")) {
    return true;
  }

  return (
    "attempt" in started &&
    isValidRecordedAttempt(started.attempt) &&
    "attempt" in terminal &&
    isValidRecordedAttempt(terminal.attempt)
  );
}

function terminalStepEventId(event: EventRecord): string {
  if (isWorkflowTerminalStepAttemptEvent(event)) {
    return event.stepId;
  }

  WorkflowStateError.eventNotTerminalStep(event.kind);
}

function terminalStepEventStepType(event: EventRecord): StepType {
  const descriptor = getEventDescriptor(event.kind);

  if (isWorkflowTerminalStepAttemptEvent(event) && descriptor.stepType !== undefined) {
    return descriptor.stepType;
  }

  WorkflowStateError.eventNotTerminalStep(event.kind);
}

function getTerminalStepAttemptIdentityKey(event: EventRecord): string | undefined {
  const attempt = getTerminalStepEventAttempt(event);

  if (!isValidRecordedAttempt(attempt)) {
    return undefined;
  }

  return `${terminalStepEventStepType(event)}:${terminalStepEventId(event)}:${attempt}`;
}

function getTerminalStepEventAttempt(event: EventRecord): number {
  if (isWorkflowTerminalStepAttemptEvent(event)) {
    const attempt = getWorkflowEventStepAttempt(event);

    if (attempt !== undefined) {
      return attempt;
    }
  }

  WorkflowStateError.eventNotTerminalStep(event.kind);
}

function startedStepAttemptIdentityKey(event: RecordedStepEvent): string | undefined {
  const attempt = getWorkflowEventStepAttempt(event);

  if (!isValidRecordedAttempt(attempt)) {
    return undefined;
  }

  return `${workflowRecordedStepEventType(event)}:${event.stepId}:${attempt}`;
}

function isStaleMessageWaitTerminalBeforeLaterStart(
  events: readonly EventRecord[],
  event: EventRecord,
): event is MessageWaitCompletedEvent | MessageWaitFailedEvent {
  if (event.kind !== "message_wait_completed" && event.kind !== "message_wait_failed") {
    return false;
  }

  const terminalIndex = events.indexOf(event);

  if (terminalIndex < 0) {
    return false;
  }

  return events
    .slice(terminalIndex + 1)
    .some(
      (started) =>
        started.kind === "message_wait_started" &&
        started.stepId === event.stepId &&
        started.stepName === event.stepName &&
        started.messageId === event.messageId,
    );
}
