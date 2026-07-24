import type {
  EventRecord,
  MessageWaitCompletedEvent,
  MessageWaitFailedEvent,
} from "../types/events.ts";
import type { WorkflowStepType } from "../types/run.ts";

import { WorkflowReplayDivergenceError, WorkflowStateError } from "../errors/mod.ts";
import {
  getEventDescriptor,
  getWorkflowEventStepAttempt,
  isWorkflowTerminalStepAttemptEvent,
} from "../events/descriptors.ts";
import {
  isWorkflowRecordedStepEvent,
  type WorkflowRecordedStepEvent,
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

export function workflowHistoryHasStartedEventBeforeTerminalEvent(
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
    WorkflowReplayDivergenceError.diverged(
      `recorded ${type} step ${stepId} has a terminal event without a started event`,
      {
        expectedStepId: stepId,
        actualStepId: stepId,
      },
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
    WorkflowReplayDivergenceError.diverged(
      `recorded ${type} step ${stepId} has multiple terminal events for attempt ${getTerminalStepEventAttempt(event)}`,
      {
        expectedStepId: stepId,
        actualStepId: stepId,
      },
    );
  }
}

export function requireWorkflowStartedEventsAreUnique(events: readonly EventRecord[]): void {
  const started = new Map<string, WorkflowRecordedStepEvent>();
  for (const event of events) {
    if (!isWorkflowRecordedStepEvent(event)) {
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
    WorkflowReplayDivergenceError.diverged(
      `recorded ${type} step ${event.stepId} has multiple started events for attempt ${getWorkflowEventStepAttempt(event)}`,
      {
        expectedStepId: event.stepId,
        actualStepId: event.stepId,
      },
    );
  }
}

function isValidRecordedAttempt(attempt: unknown): attempt is number {
  return typeof attempt === "number" && Number.isSafeInteger(attempt) && attempt > 0;
}

function recordedAttemptFieldsMatch(
  started: EventRecord,
  terminal: EventRecord,
  fields: readonly string[] = [],
): boolean {
  if (!fields.includes("attempt")) {
    return true;
  }
  return (
    isValidRecordedAttempt((started as { readonly attempt?: unknown }).attempt) &&
    isValidRecordedAttempt((terminal as { readonly attempt?: unknown }).attempt)
  );
}

function eventFieldsMatch(
  left: EventRecord,
  right: EventRecord,
  fields: readonly string[] = [],
): boolean {
  return fields.every((field) => getEventField(left, field) === getEventField(right, field));
}

function getEventField(event: EventRecord, field: string): unknown {
  return Reflect.get(event, field);
}

function terminalStepEventId(event: EventRecord): string {
  if (isWorkflowTerminalStepAttemptEvent(event)) {
    return event.stepId;
  }
  WorkflowStateError.eventNotTerminalStep(event.kind);
}

function terminalStepEventStepType(event: EventRecord): WorkflowStepType {
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

function startedStepAttemptIdentityKey(event: WorkflowRecordedStepEvent): string | undefined {
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
