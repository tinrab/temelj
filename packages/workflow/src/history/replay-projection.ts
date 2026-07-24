import type {
  ChildWorkflowCompletedEvent,
  ChildWorkflowFailedEvent,
  ChildWorkflowStartedEvent,
  DeterministicValueRecordedEvent,
  EventRecord,
  MessageSendCompletedEvent,
  MessageSendFailedEvent,
  MessageSendStartedEvent,
  MessageSentEvent,
  MessageWaitCompletedEvent,
  MessageWaitFailedEvent,
  MessageWaitStartedEvent,
  MetadataSetEvent,
  SleepCompletedEvent,
  SleepStartedEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepFailedEvent,
  WorkflowStepStartedEvent,
  StreamChunkEvent,
  StreamClosedEvent,
  StreamFailedEvent,
  StreamStartedEvent,
} from "../types/events.ts";
import type { MessageId } from "../types/message.ts";
import type { WorkflowStepAttemptRecord } from "../types/step-attempts.ts";
import type { StreamId, StreamIdOrName } from "../types/stream-id.ts";

import {
  isWorkflowRecordedStepEventKind,
  isWorkflowTerminalStepAttemptEvent,
} from "../events/descriptors.ts";
import { StepId } from "../types/step.ts";
import { workflowStartedEventMatchesTerminalEvent } from "./validator.ts";

export interface IndexedWorkflowEvent<TEvent extends EventRecord> {
  index: number;
  event: TEvent;
}

export interface WorkflowReplayProjection {
  startedEventsByStepId: Map<StepId, EventRecord[]>;
  startedStep: Map<StepId, WorkflowStepStartedEvent>;
  completedStep: Map<StepId, WorkflowStepCompletedEvent>;
  failedSteps: Map<StepId, WorkflowStepFailedEvent[]>;
  unstartedFailedStep: Map<StepId, WorkflowStepFailedEvent>;
  metadataSet: Map<StepId, MetadataSetEvent>;
  attributesSet: Map<StepId, Extract<EventRecord, { kind: "attributes_set" }>>;
  startedStepAttempts: Map<StepId, WorkflowStepStartedEvent[]>;
  nextStepAttemptByStepId: Map<StepId, number>;
  invalidStartedStepAttempt: Map<StepId, WorkflowStepStartedEvent>;
  startedSleep: Map<StepId, SleepStartedEvent>;
  completedSleep: Map<StepId, SleepCompletedEvent>;
  startedChildWorkflow: Map<StepId, ChildWorkflowStartedEvent>;
  completedChildWorkflow: Map<StepId, ChildWorkflowCompletedEvent>;
  failedChildWorkflow: Map<StepId, ChildWorkflowFailedEvent>;
  childWorkflowStartedByAttemptKey: Map<string, IndexedWorkflowEvent<ChildWorkflowStartedEvent>>;
  childWorkflowStartedByStepId: Map<StepId, IndexedWorkflowEvent<ChildWorkflowStartedEvent>[]>;
  childWorkflowCompletedByStepId: Map<StepId, IndexedWorkflowEvent<ChildWorkflowCompletedEvent>[]>;
  childWorkflowFailedByStepId: Map<StepId, IndexedWorkflowEvent<ChildWorkflowFailedEvent>[]>;
  startedMessageWait: Map<StepId, MessageWaitStartedEvent>;
  messageWaitStartedByNameAndMessageId: Map<
    string,
    IndexedWorkflowEvent<MessageWaitStartedEvent>[]
  >;
  messageWaitStartedIndex: Map<MessageWaitStartedEvent, number>;
  latestMessageWaitStartedIndex: Map<StepId, number>;
  completedMessageWait: Map<StepId, IndexedWorkflowEvent<MessageWaitCompletedEvent>[]>;
  failedMessageWait: Map<StepId, IndexedWorkflowEvent<MessageWaitFailedEvent>[]>;
  messageSentById: Map<MessageId, IndexedWorkflowEvent<MessageSentEvent>[]>;
  activeMessageWaitsByMessageId: Map<MessageId, Map<StepId, string>>;
  messageSentByIdempotencyKey: Map<string, MessageSentEvent>;
  latestMessageSentByIdempotencyKey: Map<string, MessageSentEvent>;
  startedMessageSend: Map<StepId, MessageSendStartedEvent>;
  completedMessageSend: Map<StepId, MessageSendCompletedEvent>;
  failedMessageSend: Map<StepId, MessageSendFailedEvent>;
  startedStream: Map<StepId, StreamStartedEvent>;
  streamChunks: Map<StepId, StreamChunkEvent[]>;
  streamChunkByIndex: Map<StepId, Map<number, StreamChunkEvent>>;
  streamStartedByIdOrName: Map<string, IndexedWorkflowEvent<StreamStartedEvent>>;
  streamChunksByStreamId: Map<StreamId, IndexedWorkflowEvent<StreamChunkEvent>[]>;
  streamClosedByStreamId: Map<StreamId, IndexedWorkflowEvent<StreamClosedEvent>>;
  streamFailedByStreamId: Map<StreamId, IndexedWorkflowEvent<StreamFailedEvent>>;
  closedStream: Map<StepId, StreamClosedEvent>;
  failedStream: Map<StepId, StreamFailedEvent>;
  deterministicValue: Map<StepId, DeterministicValueRecordedEvent>;
  terminalStartedBefore: Set<EventRecord>;
  workflowStartedCount: number;
  totalStartedStepCount: number;
}

export function createWorkflowReplayProjection(events: EventRecord[]): WorkflowReplayProjection {
  const projection = {
    startedEventsByStepId: new Map<StepId, EventRecord[]>(),
    startedStep: new Map<StepId, WorkflowStepStartedEvent>(),
    completedStep: new Map<StepId, WorkflowStepCompletedEvent>(),
    failedSteps: new Map<StepId, WorkflowStepFailedEvent[]>(),
    unstartedFailedStep: new Map<StepId, WorkflowStepFailedEvent>(),
    metadataSet: new Map<StepId, MetadataSetEvent>(),
    attributesSet: new Map<StepId, Extract<EventRecord, { kind: "attributes_set" }>>(),
    startedStepAttempts: new Map<StepId, WorkflowStepStartedEvent[]>(),
    nextStepAttemptByStepId: new Map<StepId, number>(),
    invalidStartedStepAttempt: new Map<StepId, WorkflowStepStartedEvent>(),
    startedSleep: new Map<StepId, SleepStartedEvent>(),
    completedSleep: new Map<StepId, SleepCompletedEvent>(),
    startedChildWorkflow: new Map<StepId, ChildWorkflowStartedEvent>(),
    completedChildWorkflow: new Map<StepId, ChildWorkflowCompletedEvent>(),
    failedChildWorkflow: new Map<StepId, ChildWorkflowFailedEvent>(),
    childWorkflowStartedByAttemptKey: new Map<
      string,
      IndexedWorkflowEvent<ChildWorkflowStartedEvent>
    >(),
    childWorkflowStartedByStepId: new Map<
      StepId,
      IndexedWorkflowEvent<ChildWorkflowStartedEvent>[]
    >(),
    childWorkflowCompletedByStepId: new Map<
      StepId,
      IndexedWorkflowEvent<ChildWorkflowCompletedEvent>[]
    >(),
    childWorkflowFailedByStepId: new Map<
      StepId,
      IndexedWorkflowEvent<ChildWorkflowFailedEvent>[]
    >(),
    startedMessageWait: new Map<StepId, MessageWaitStartedEvent>(),
    messageWaitStartedByNameAndMessageId: new Map<
      string,
      IndexedWorkflowEvent<MessageWaitStartedEvent>[]
    >(),
    messageWaitStartedIndex: new Map<MessageWaitStartedEvent, number>(),
    latestMessageWaitStartedIndex: new Map<StepId, number>(),
    completedMessageWait: new Map<StepId, IndexedWorkflowEvent<MessageWaitCompletedEvent>[]>(),
    failedMessageWait: new Map<StepId, IndexedWorkflowEvent<MessageWaitFailedEvent>[]>(),
    messageSentById: new Map<MessageId, IndexedWorkflowEvent<MessageSentEvent>[]>(),
    activeMessageWaitsByMessageId: new Map<MessageId, Map<StepId, string>>(),
    messageSentByIdempotencyKey: new Map<string, MessageSentEvent>(),
    latestMessageSentByIdempotencyKey: new Map<string, MessageSentEvent>(),
    startedMessageSend: new Map<StepId, MessageSendStartedEvent>(),
    completedMessageSend: new Map<StepId, MessageSendCompletedEvent>(),
    failedMessageSend: new Map<StepId, MessageSendFailedEvent>(),
    startedStream: new Map<StepId, StreamStartedEvent>(),
    streamChunks: new Map<StepId, StreamChunkEvent[]>(),
    streamChunkByIndex: new Map<StepId, Map<number, StreamChunkEvent>>(),
    streamStartedByIdOrName: new Map<string, IndexedWorkflowEvent<StreamStartedEvent>>(),
    streamChunksByStreamId: new Map<StreamId, IndexedWorkflowEvent<StreamChunkEvent>[]>(),
    streamClosedByStreamId: new Map<StreamId, IndexedWorkflowEvent<StreamClosedEvent>>(),
    streamFailedByStreamId: new Map<StreamId, IndexedWorkflowEvent<StreamFailedEvent>>(),
    closedStream: new Map<StepId, StreamClosedEvent>(),
    failedStream: new Map<StepId, StreamFailedEvent>(),
    deterministicValue: new Map<StepId, DeterministicValueRecordedEvent>(),
    terminalStartedBefore: new Set<EventRecord>(),
    workflowStartedCount: 0,
    totalStartedStepCount: 0,
  };

  for (const [index, event] of events.entries()) {
    appendWorkflowReplayProjectionEvent(projection, event, index);
  }

  return projection;
}

export function appendWorkflowReplayProjectionEvents(
  projection: WorkflowReplayProjection,
  events: EventRecord[],
  startIndex: number,
): WorkflowReplayProjection {
  for (const [offset, event] of events.entries()) {
    appendWorkflowReplayProjectionEvent(projection, event, startIndex + offset);
  }
  return projection;
}

function appendWorkflowReplayProjectionEvent(
  projection: WorkflowReplayProjection,
  event: EventRecord,
  index: number,
): void {
  if (
    isWorkflowTerminalStepAttemptEvent(event) &&
    (projection.startedEventsByStepId.get(event.stepId) ?? []).some((started) =>
      workflowStartedEventMatchesTerminalEvent(started, event),
    )
  ) {
    projection.terminalStartedBefore.add(event);
  }

  switch (event.kind) {
    case "workflow_started": {
      incrementWorkflowStartedCount(projection);
      break;
    }
    case "step_started": {
      projection.startedStep.set(event.stepId, event);
      appendProjectedEvent(projection.startedStepAttempts, event.stepId, event);
      recordProjectedStepAttempt(projection, event);
      appendStartedEvent(projection.startedEventsByStepId, event);
      incrementTotalStartedStepCount(projection);
      break;
    }
    case "step_completed": {
      projection.completedStep.set(event.stepId, event);
      break;
    }
    case "step_failed": {
      appendProjectedEvent(projection.failedSteps, event.stepId, event);
      if (!projection.terminalStartedBefore.has(event)) {
        const failedSteps = projection.unstartedFailedStep;
        if (!failedSteps.has(event.stepId)) {
          failedSteps.set(event.stepId, event);
        }
      }
      break;
    }
    case "metadata_set": {
      projection.metadataSet.set(event.stepId, event);
      break;
    }
    case "attributes_set": {
      projection.attributesSet.set(event.stepId, event);
      break;
    }
    case "sleep_started": {
      projection.startedSleep.set(event.stepId, event);
      appendStartedEvent(projection.startedEventsByStepId, event);
      incrementTotalStartedStepCount(projection);
      break;
    }
    case "sleep_completed": {
      projection.completedSleep.set(event.stepId, event);
      break;
    }
    case "child_workflow_started": {
      projection.startedChildWorkflow.set(event.stepId, event);
      const startedWorkflows = projection.childWorkflowStartedByAttemptKey;
      const childWorkflowKey = workflowChildWorkflowAttemptKey(event);
      if (!startedWorkflows.has(childWorkflowKey)) {
        startedWorkflows.set(childWorkflowKey, { index, event });
      }
      appendProjectedEvent(projection.childWorkflowStartedByStepId, event.stepId, {
        index,
        event,
      });
      appendStartedEvent(projection.startedEventsByStepId, event);
      incrementTotalStartedStepCount(projection);
      break;
    }
    case "child_workflow_completed": {
      projection.completedChildWorkflow.set(event.stepId, event);
      appendProjectedEvent(projection.childWorkflowCompletedByStepId, event.stepId, {
        index,
        event,
      });
      break;
    }
    case "child_workflow_failed": {
      projection.failedChildWorkflow.set(event.stepId, event);
      appendProjectedEvent(projection.childWorkflowFailedByStepId, event.stepId, {
        index,
        event,
      });
      break;
    }
    case "message_wait_started": {
      projection.startedMessageWait.set(event.stepId, event);
      activeMessageWaits(projection, event.messageId).set(event.stepId, event.stepName);
      appendProjectedEvent(
        projection.messageWaitStartedByNameAndMessageId,
        workflowMessageWaitNameMessageKey(event.stepName, event.messageId),
        { index, event },
      );
      projection.messageWaitStartedIndex.set(event, index);
      projection.latestMessageWaitStartedIndex.set(event.stepId, index);
      appendStartedEvent(projection.startedEventsByStepId, event);
      incrementTotalStartedStepCount(projection);
      break;
    }
    case "message_wait_completed": {
      deleteActiveMessageWait(projection, event);
      appendProjectedEvent(projection.completedMessageWait, event.stepId, {
        index,
        event,
      });
      break;
    }
    case "message_wait_failed": {
      deleteActiveMessageWait(projection, event);
      appendProjectedEvent(projection.failedMessageWait, event.stepId, {
        index,
        event,
      });
      break;
    }
    case "message_sent": {
      appendProjectedEvent(projection.messageSentById, event.messageId, {
        index,
        event,
      });
      if (event.idempotencyKey !== undefined) {
        const messages = projection.messageSentByIdempotencyKey;
        if (!messages.has(event.idempotencyKey)) {
          messages.set(event.idempotencyKey, event);
        }
        projection.latestMessageSentByIdempotencyKey.set(event.idempotencyKey, event);
      }
      break;
    }
    case "message_send_started": {
      projection.startedMessageSend.set(event.stepId, event);
      appendStartedEvent(projection.startedEventsByStepId, event);
      incrementTotalStartedStepCount(projection);
      break;
    }
    case "message_send_completed": {
      projection.completedMessageSend.set(event.stepId, event);
      break;
    }
    case "message_send_failed": {
      projection.failedMessageSend.set(event.stepId, event);
      break;
    }
    case "stream_started": {
      projection.startedStream.set(event.stepId, event);
      setProjectedStreamStartedByIdOrName(projection, event, index);
      appendStartedEvent(projection.startedEventsByStepId, event);
      incrementTotalStartedStepCount(projection);
      break;
    }
    case "stream_chunk": {
      appendProjectedEvent(projection.streamChunks, event.stepId, event);
      appendProjectedEvent(projection.streamChunksByStreamId, event.streamId, {
        index,
        event,
      });
      setProjectedStreamChunkByIndex(projection, event);
      break;
    }
    case "stream_closed": {
      projection.closedStream.set(event.stepId, event);
      const closed = projection.streamClosedByStreamId;
      if (!closed.has(event.streamId)) {
        closed.set(event.streamId, { index, event });
      }
      break;
    }
    case "stream_failed": {
      projection.failedStream.set(event.stepId, event);
      const failed = projection.streamFailedByStreamId;
      if (!failed.has(event.streamId)) {
        failed.set(event.streamId, { index, event });
      }
      break;
    }
    case "deterministic_value_recorded": {
      projection.deterministicValue.set(event.stepId, event);
      break;
    }
  }
}

function appendStartedEvent(
  startedEventsByStepId: Map<StepId, EventRecord[]>,
  event: EventRecord,
): void {
  if (!isWorkflowRecordedStepEventKind(event.kind) || !("stepId" in event)) {
    return;
  }
  appendProjectedEvent(startedEventsByStepId, event.stepId, event);
}

function recordProjectedStepAttempt(
  projection: WorkflowReplayProjection,
  event: WorkflowStepStartedEvent,
): void {
  if (!(Number.isSafeInteger(event.attempt) && event.attempt > 0)) {
    projection.invalidStartedStepAttempt.set(event.stepId, event);
    return;
  }
  const nextAttempt = event.attempt + 1;
  projection.nextStepAttemptByStepId.set(
    event.stepId,
    Math.max(projection.nextStepAttemptByStepId.get(event.stepId) ?? 1, nextAttempt),
  );
}

function incrementTotalStartedStepCount(projection: WorkflowReplayProjection): void {
  asMutableProjection(projection).totalStartedStepCount++;
}

function incrementWorkflowStartedCount(projection: WorkflowReplayProjection): void {
  asMutableProjection(projection).workflowStartedCount++;
}

function asMutableProjection(projection: WorkflowReplayProjection): WorkflowReplayProjection & {
  workflowStartedCount: number;
  totalStartedStepCount: number;
} {
  return projection as WorkflowReplayProjection & {
    workflowStartedCount: number;
    totalStartedStepCount: number;
  };
}

function setProjectedStreamChunkByIndex(
  projection: WorkflowReplayProjection,
  event: StreamChunkEvent,
): void {
  const chunks = projection.streamChunkByIndex.get(event.stepId);
  if (chunks === undefined) {
    projection.streamChunkByIndex.set(event.stepId, new Map([[event.index, event]]));
    return;
  }
  if (!chunks.has(event.index)) {
    chunks.set(event.index, event);
  }
}

function setProjectedStreamStartedByIdOrName(
  projection: WorkflowReplayProjection,
  event: StreamStartedEvent,
  index: number,
): void {
  if (!projection.streamStartedByIdOrName.has(event.streamId)) {
    projection.streamStartedByIdOrName.set(event.streamId, { index, event });
  }
  if (!projection.streamStartedByIdOrName.has(event.stepName)) {
    projection.streamStartedByIdOrName.set(event.stepName, { index, event });
  }
}

function activeMessageWaits(
  projection: WorkflowReplayProjection,
  messageId: MessageId,
): Map<StepId, string> {
  const waits = projection.activeMessageWaitsByMessageId.get(messageId);
  if (waits !== undefined) {
    return waits;
  }
  const nextWaits = new Map<StepId, string>();
  projection.activeMessageWaitsByMessageId.set(messageId, nextWaits);
  return nextWaits;
}

function deleteActiveMessageWait(
  projection: WorkflowReplayProjection,
  event: MessageWaitCompletedEvent | MessageWaitFailedEvent,
): void {
  const activeWaits = activeMessageWaits(projection, event.messageId);
  if (activeWaits.get(event.stepId) === event.stepName) {
    activeWaits.delete(event.stepId);
  }
}

export function findLastIndexedWorkflowEventAfter<
  TEvent extends EventRecord,
  TMatch extends TEvent,
>(
  entries: IndexedWorkflowEvent<TEvent>[],
  afterIndex: number,
  predicate: (event: TEvent) => event is TMatch,
): TMatch | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.index > afterIndex && predicate(entry.event)) {
      return entry.event;
    }
  }
  return undefined;
}

function findLastIndexedWorkflowEventEntryAfter<TEvent extends EventRecord, TMatch extends TEvent>(
  entries: IndexedWorkflowEvent<TEvent>[],
  afterIndex: number,
  predicate: (event: TEvent) => event is TMatch,
): IndexedWorkflowEvent<TMatch> | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    const event = entry.event;
    if (entry.index > afterIndex && predicate(event)) {
      return { index: entry.index, event };
    }
  }
  return undefined;
}

export function findWorkflowMessageSentForWait(
  projection: WorkflowReplayProjection,
  messageId: MessageId,
  stepId: StepId,
  timeoutAt: Temporal.Instant | undefined,
): MessageSentEvent | undefined {
  const waitStartedIndex = projection.latestMessageWaitStartedIndex.get(stepId) ?? -1;
  return (projection.messageSentById.get(messageId) ?? []).find(({ index, event }) => {
    return (
      index > waitStartedIndex &&
      (event.waiterStepIds === undefined || event.waiterStepIds.includes(stepId)) &&
      (timeoutAt === undefined || Temporal.Instant.compare(event.timestamp, timeoutAt) < 0)
    );
  })?.event;
}

export function findWorkflowMessageSentByTimestamp(
  projection: WorkflowReplayProjection,
  messageId: MessageId,
  timestamp: Temporal.Instant,
): MessageSentEvent | undefined {
  return findLastIndexedWorkflowEventAfter(
    projection.messageSentById.get(messageId) ?? [],
    -1,
    (event): event is MessageSentEvent =>
      Temporal.Instant.compare(event.timestamp, timestamp) === 0,
  );
}

export interface StreamEventProjection {
  started: StreamStartedEvent;
  chunks: IndexedWorkflowEvent<StreamChunkEvent>[];
  closed?: IndexedWorkflowEvent<StreamClosedEvent>;
  failed?: IndexedWorkflowEvent<StreamFailedEvent>;
}

export function findStreamEventProjection(
  projection: WorkflowReplayProjection,
  streamIdOrName: StreamIdOrName,
): StreamEventProjection | undefined {
  const started = projection.streamStartedByIdOrName.get(streamIdOrName);
  if (started === undefined) {
    return undefined;
  }
  return {
    started: started.event,
    chunks: [...(projection.streamChunksByStreamId.get(started.event.streamId) ?? [])].sort(
      (left, right) => left.event.index - right.event.index,
    ),
    ...(projection.streamClosedByStreamId.get(started.event.streamId) === undefined
      ? {}
      : { closed: projection.streamClosedByStreamId.get(started.event.streamId) }),
    ...(projection.streamFailedByStreamId.get(started.event.streamId) === undefined
      ? {}
      : { failed: projection.streamFailedByStreamId.get(started.event.streamId) }),
  };
}

export function findLastWorkflowSleepStartedForCompleted(
  projection: WorkflowReplayProjection,
  completed: SleepCompletedEvent,
): SleepStartedEvent | undefined {
  const started = projection.startedSleep.get(completed.stepId);
  return started?.stepName === completed.stepName ? started : undefined;
}

export function findLastMessageWaitStartedForCompleted(
  projection: WorkflowReplayProjection,
  completed: MessageWaitCompletedEvent,
): MessageWaitStartedEvent | undefined {
  const started = projection.startedMessageWait.get(completed.stepId);
  return started?.stepName === completed.stepName && started.messageId === completed.messageId
    ? started
    : undefined;
}

export function findLastWorkflowChildWorkflowStartedForTerminal(
  projection: WorkflowReplayProjection,
  terminal: ChildWorkflowCompletedEvent | ChildWorkflowFailedEvent,
): ChildWorkflowStartedEvent | undefined {
  return findLastIndexedWorkflowEventAfter(
    projection.childWorkflowStartedByStepId.get(terminal.stepId) ?? [],
    -1,
    (event): event is ChildWorkflowStartedEvent =>
      workflowChildWorkflowTerminalMatchesStarted(terminal, event),
  );
}

export interface WorkflowChildWorkflowLifecycle {
  started?: ChildWorkflowStartedEvent;
  hasTerminalAfterStarted: boolean;
}

export function findWorkflowChildWorkflowLifecycleForAttempt(
  projection: WorkflowReplayProjection,
  attempt: WorkflowStepAttemptRecord,
): WorkflowChildWorkflowLifecycle {
  const started = projection.childWorkflowStartedByAttemptKey.get(
    workflowChildWorkflowAttemptKey(attempt),
  );
  if (started === undefined) {
    return { hasTerminalAfterStarted: false };
  }
  return {
    started: started.event,
    hasTerminalAfterStarted: hasWorkflowChildWorkflowTerminalAfterStarted(projection, started),
  };
}

function hasWorkflowChildWorkflowTerminalAfterStarted(
  projection: WorkflowReplayProjection,
  started: IndexedWorkflowEvent<ChildWorkflowStartedEvent>,
): boolean {
  return (
    findLastIndexedWorkflowEventEntryAfter(
      projection.childWorkflowCompletedByStepId.get(started.event.stepId) ?? [],
      started.index,
      (event): event is ChildWorkflowCompletedEvent =>
        workflowChildWorkflowTerminalMatchesStarted(event, started.event),
    ) !== undefined ||
    findLastIndexedWorkflowEventEntryAfter(
      projection.childWorkflowFailedByStepId.get(started.event.stepId) ?? [],
      started.index,
      (event): event is ChildWorkflowFailedEvent =>
        workflowChildWorkflowTerminalMatchesStarted(event, started.event),
    ) !== undefined
  );
}

export function activeMessageWaitStepIds(
  projection: WorkflowReplayProjection,
  messageId: MessageId,
): StepId[] {
  return [...(projection.activeMessageWaitsByMessageId.get(messageId)?.keys() ?? [])];
}

export function findLastMessageWaitStartedByNameAndMessageId(
  projection: WorkflowReplayProjection,
  stepName: string,
  messageId: MessageId,
): MessageWaitStartedEvent | undefined {
  const entries =
    projection.messageWaitStartedByNameAndMessageId.get(
      workflowMessageWaitNameMessageKey(stepName, messageId),
    ) ?? [];
  return entries.at(-1)?.event;
}

export function findLastMessageWaitTerminalAfterStarted(
  projection: WorkflowReplayProjection,
  started: MessageWaitStartedEvent,
): MessageWaitCompletedEvent | MessageWaitFailedEvent | undefined {
  const startedIndex = projection.messageWaitStartedIndex.get(started);
  if (startedIndex === undefined) {
    return undefined;
  }
  const completed = findLastIndexedWorkflowEventEntryAfter(
    projection.completedMessageWait.get(started.stepId) ?? [],
    startedIndex,
    (event): event is MessageWaitCompletedEvent =>
      event.stepName === started.stepName && event.messageId === started.messageId,
  );
  const failed = findLastIndexedWorkflowEventEntryAfter(
    projection.failedMessageWait.get(started.stepId) ?? [],
    startedIndex,
    (event): event is MessageWaitFailedEvent =>
      event.stepName === started.stepName && event.messageId === started.messageId,
  );
  if (completed === undefined) {
    return failed?.event;
  }
  if (failed === undefined) {
    return completed.event;
  }
  return completed.index > failed.index ? completed.event : failed.event;
}

export function findWorkflowMessageSentByIdempotencyKey(
  projection: WorkflowReplayProjection,
  idempotencyKey: string | undefined,
): MessageSentEvent | undefined {
  return idempotencyKey === undefined
    ? undefined
    : projection.messageSentByIdempotencyKey.get(idempotencyKey);
}

export function findLastWorkflowMessageSentById(
  projection: WorkflowReplayProjection,
  messageId: MessageId,
): MessageSentEvent | undefined {
  const entries = projection.messageSentById.get(messageId) ?? [];
  return entries.at(-1)?.event;
}

function appendProjectedEvent<TKey, TEvent>(
  map: Map<TKey, TEvent[]>,
  stepId: TKey,
  event: TEvent,
): void {
  const events = map.get(stepId);
  if (events === undefined) {
    map.set(stepId, [event]);
    return;
  }
  events.push(event);
}

function workflowMessageWaitNameMessageKey(stepName: string, messageId: MessageId): string {
  return `${stepName}\u0000${messageId}`;
}

function workflowChildWorkflowAttemptKey(
  event: ChildWorkflowStartedEvent | WorkflowStepAttemptRecord,
): string {
  return [
    workflowProjectionKeyPart(event.childRunId),
    workflowProjectionKeyPart(event.stepId),
    workflowProjectionKeyPart(event.stepName),
    workflowProjectionKeyPart(event.attempt),
    workflowProjectionKeyPart(event.count),
    workflowProjectionKeyPart(event.workflowName),
    workflowProjectionKeyPart(event.workflowVersion),
    workflowProjectionKeyPart(event.cancellation ?? "cascade"),
  ].join("\u0000");
}

function workflowProjectionKeyPart(value: string | number | undefined): string {
  return value === undefined ? "\u0001" : String(value);
}

function workflowChildWorkflowTerminalMatchesStarted(
  event: ChildWorkflowCompletedEvent | ChildWorkflowFailedEvent,
  started: ChildWorkflowStartedEvent,
): boolean {
  return (
    event.stepId === started.stepId &&
    event.stepName === started.stepName &&
    event.childRunId === started.childRunId &&
    event.attempt === started.attempt
  );
}
