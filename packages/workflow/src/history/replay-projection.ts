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
  StepCompletedEvent,
  StepFailedEvent,
  StepStartedEvent,
  StreamChunkEvent,
  StreamClosedEvent,
  StreamFailedEvent,
  StreamStartedEvent,
} from "../types/events.ts";
import type { MessageId, StreamId, StreamIdOrName, StepId } from "../types/ids.ts";
import type { StepAttemptRecord } from "../types/step-attempts.ts";

import {
  isWorkflowRecordedStepEventKind,
  isWorkflowTerminalStepAttemptEvent,
} from "../events/descriptors.ts";
import { workflowStartedEventMatchesTerminalEvent } from "./validator.ts";

interface IndexedEvent<TEvent extends EventRecord> {
  index: number;
  event: TEvent;
}

export interface ReplayProjection {
  startedEventsByStepId: Map<StepId, EventRecord[]>;
  startedStep: Map<StepId, StepStartedEvent>;
  completedStep: Map<StepId, StepCompletedEvent>;
  failedSteps: Map<StepId, StepFailedEvent[]>;
  unstartedFailedStep: Map<StepId, StepFailedEvent>;
  metadataSet: Map<StepId, MetadataSetEvent>;
  attributesSet: Map<StepId, Extract<EventRecord, { kind: "attributes_set" }>>;
  startedStepAttempts: Map<StepId, StepStartedEvent[]>;
  nextStepAttemptByStepId: Map<StepId, number>;
  invalidStartedStepAttempt: Map<StepId, StepStartedEvent>;
  startedSleep: Map<StepId, SleepStartedEvent>;
  completedSleep: Map<StepId, SleepCompletedEvent>;
  startedChildWorkflow: Map<StepId, ChildWorkflowStartedEvent>;
  completedChildWorkflow: Map<StepId, ChildWorkflowCompletedEvent>;
  failedChildWorkflow: Map<StepId, ChildWorkflowFailedEvent>;
  childWorkflowStartedByAttemptKey: Map<string, IndexedEvent<ChildWorkflowStartedEvent>>;
  childWorkflowStartedByStepId: Map<StepId, IndexedEvent<ChildWorkflowStartedEvent>[]>;
  childWorkflowCompletedByStepId: Map<StepId, IndexedEvent<ChildWorkflowCompletedEvent>[]>;
  childWorkflowFailedByStepId: Map<StepId, IndexedEvent<ChildWorkflowFailedEvent>[]>;
  startedMessageWait: Map<StepId, MessageWaitStartedEvent>;
  messageWaitStartedByNameAndMessageId: Map<string, IndexedEvent<MessageWaitStartedEvent>[]>;
  messageWaitStartedIndex: Map<MessageWaitStartedEvent, number>;
  latestMessageWaitStartedIndex: Map<StepId, number>;
  completedMessageWait: Map<StepId, IndexedEvent<MessageWaitCompletedEvent>[]>;
  failedMessageWait: Map<StepId, IndexedEvent<MessageWaitFailedEvent>[]>;
  messageSentById: Map<MessageId, IndexedEvent<MessageSentEvent>[]>;
  activeMessageWaitsByMessageId: Map<MessageId, Map<StepId, string>>;
  messageSentByIdempotencyKey: Map<string, MessageSentEvent>;
  latestMessageSentByIdempotencyKey: Map<string, MessageSentEvent>;
  startedMessageSend: Map<StepId, MessageSendStartedEvent>;
  completedMessageSend: Map<StepId, MessageSendCompletedEvent>;
  failedMessageSend: Map<StepId, MessageSendFailedEvent>;
  startedStream: Map<StepId, StreamStartedEvent>;
  streamChunks: Map<StepId, StreamChunkEvent[]>;
  streamChunkByIndex: Map<StepId, Map<number, StreamChunkEvent>>;
  streamStartedByIdOrName: Map<string, IndexedEvent<StreamStartedEvent>>;
  streamChunksByStreamId: Map<StreamId, IndexedEvent<StreamChunkEvent>[]>;
  streamClosedByStreamId: Map<StreamId, IndexedEvent<StreamClosedEvent>>;
  streamFailedByStreamId: Map<StreamId, IndexedEvent<StreamFailedEvent>>;
  closedStream: Map<StepId, StreamClosedEvent>;
  failedStream: Map<StepId, StreamFailedEvent>;
  deterministicValue: Map<StepId, DeterministicValueRecordedEvent>;
  terminalStartedBefore: Set<EventRecord>;
  workflowStartedCount: number;
  totalStartedStepCount: number;
}

export function createReplayProjection(events: EventRecord[]): ReplayProjection {
  const projection = {
    startedEventsByStepId: new Map<StepId, EventRecord[]>(),
    startedStep: new Map<StepId, StepStartedEvent>(),
    completedStep: new Map<StepId, StepCompletedEvent>(),
    failedSteps: new Map<StepId, StepFailedEvent[]>(),
    unstartedFailedStep: new Map<StepId, StepFailedEvent>(),
    metadataSet: new Map<StepId, MetadataSetEvent>(),
    attributesSet: new Map<StepId, Extract<EventRecord, { kind: "attributes_set" }>>(),
    startedStepAttempts: new Map<StepId, StepStartedEvent[]>(),
    nextStepAttemptByStepId: new Map<StepId, number>(),
    invalidStartedStepAttempt: new Map<StepId, StepStartedEvent>(),
    startedSleep: new Map<StepId, SleepStartedEvent>(),
    completedSleep: new Map<StepId, SleepCompletedEvent>(),
    startedChildWorkflow: new Map<StepId, ChildWorkflowStartedEvent>(),
    completedChildWorkflow: new Map<StepId, ChildWorkflowCompletedEvent>(),
    failedChildWorkflow: new Map<StepId, ChildWorkflowFailedEvent>(),
    childWorkflowStartedByAttemptKey: new Map<string, IndexedEvent<ChildWorkflowStartedEvent>>(),
    childWorkflowStartedByStepId: new Map<StepId, IndexedEvent<ChildWorkflowStartedEvent>[]>(),
    childWorkflowCompletedByStepId: new Map<StepId, IndexedEvent<ChildWorkflowCompletedEvent>[]>(),
    childWorkflowFailedByStepId: new Map<StepId, IndexedEvent<ChildWorkflowFailedEvent>[]>(),
    startedMessageWait: new Map<StepId, MessageWaitStartedEvent>(),
    messageWaitStartedByNameAndMessageId: new Map<
      string,
      IndexedEvent<MessageWaitStartedEvent>[]
    >(),
    messageWaitStartedIndex: new Map<MessageWaitStartedEvent, number>(),
    latestMessageWaitStartedIndex: new Map<StepId, number>(),
    completedMessageWait: new Map<StepId, IndexedEvent<MessageWaitCompletedEvent>[]>(),
    failedMessageWait: new Map<StepId, IndexedEvent<MessageWaitFailedEvent>[]>(),
    messageSentById: new Map<MessageId, IndexedEvent<MessageSentEvent>[]>(),
    activeMessageWaitsByMessageId: new Map<MessageId, Map<StepId, string>>(),
    messageSentByIdempotencyKey: new Map<string, MessageSentEvent>(),
    latestMessageSentByIdempotencyKey: new Map<string, MessageSentEvent>(),
    startedMessageSend: new Map<StepId, MessageSendStartedEvent>(),
    completedMessageSend: new Map<StepId, MessageSendCompletedEvent>(),
    failedMessageSend: new Map<StepId, MessageSendFailedEvent>(),
    startedStream: new Map<StepId, StreamStartedEvent>(),
    streamChunks: new Map<StepId, StreamChunkEvent[]>(),
    streamChunkByIndex: new Map<StepId, Map<number, StreamChunkEvent>>(),
    streamStartedByIdOrName: new Map<string, IndexedEvent<StreamStartedEvent>>(),
    streamChunksByStreamId: new Map<StreamId, IndexedEvent<StreamChunkEvent>[]>(),
    streamClosedByStreamId: new Map<StreamId, IndexedEvent<StreamClosedEvent>>(),
    streamFailedByStreamId: new Map<StreamId, IndexedEvent<StreamFailedEvent>>(),
    closedStream: new Map<StepId, StreamClosedEvent>(),
    failedStream: new Map<StepId, StreamFailedEvent>(),
    deterministicValue: new Map<StepId, DeterministicValueRecordedEvent>(),
    terminalStartedBefore: new Set<EventRecord>(),
    workflowStartedCount: 0,
    totalStartedStepCount: 0,
  };

  for (const [index, event] of events.entries()) {
    appendReplayProjectionEvent(projection, event, index);
  }

  return projection;
}

export function appendReplayProjectionEvents(
  projection: ReplayProjection,
  events: EventRecord[],
  startIndex: number,
): ReplayProjection {
  for (const [offset, event] of events.entries()) {
    appendReplayProjectionEvent(projection, event, startIndex + offset);
  }

  return projection;
}

function appendReplayProjectionEvent(
  projection: ReplayProjection,
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
      projection.workflowStartedCount++;
      break;
    }

    case "step_started": {
      projection.startedStep.set(event.stepId, event);
      appendProjectedEvent(projection.startedStepAttempts, event.stepId, event);
      recordProjectedStepAttempt(projection, event);
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
      break;
    }

    case "sleep_completed": {
      projection.completedSleep.set(event.stepId, event);
      break;
    }

    case "child_workflow_started": {
      projection.startedChildWorkflow.set(event.stepId, event);
      const startedWorkflows = projection.childWorkflowStartedByAttemptKey;
      const childWorkflowKey = childWorkflowAttemptKey(event);

      if (!startedWorkflows.has(childWorkflowKey)) {
        startedWorkflows.set(childWorkflowKey, { index, event });
      }

      appendProjectedEvent(projection.childWorkflowStartedByStepId, event.stepId, {
        index,
        event,
      });
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

  if (STEP_STARTED_KINDS.has(event.kind)) {
    appendStartedEvent(projection.startedEventsByStepId, event);
    projection.totalStartedStepCount++;
  }
}

const STEP_STARTED_KINDS: ReadonlySet<EventRecord["kind"]> = new Set([
  "step_started",
  "sleep_started",
  "child_workflow_started",
  "message_wait_started",
  "message_send_started",
  "stream_started",
]);

function appendStartedEvent(
  startedEventsByStepId: Map<StepId, EventRecord[]>,
  event: EventRecord,
): void {
  if (!isWorkflowRecordedStepEventKind(event.kind) || !("stepId" in event)) {
    return;
  }

  appendProjectedEvent(startedEventsByStepId, event.stepId, event);
}

function recordProjectedStepAttempt(projection: ReplayProjection, event: StepStartedEvent): void {
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

function setProjectedStreamChunkByIndex(
  projection: ReplayProjection,
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
  projection: ReplayProjection,
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
  projection: ReplayProjection,
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
  projection: ReplayProjection,
  event: MessageWaitCompletedEvent | MessageWaitFailedEvent,
): void {
  const activeWaits = activeMessageWaits(projection, event.messageId);

  if (activeWaits.get(event.stepId) === event.stepName) {
    activeWaits.delete(event.stepId);
  }
}

export function findLastIndexedEventAfter<TEvent extends EventRecord, TMatch extends TEvent>(
  entries: IndexedEvent<TEvent>[],
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

function findLastIndexedEventEntryAfter<TEvent extends EventRecord, TMatch extends TEvent>(
  entries: IndexedEvent<TEvent>[],
  afterIndex: number,
  predicate: (event: TEvent) => event is TMatch,
): IndexedEvent<TMatch> | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    const event = entry.event;

    if (entry.index > afterIndex && predicate(event)) {
      return { index: entry.index, event };
    }
  }

  return undefined;
}

export function findMessageSentForWait(
  projection: ReplayProjection,
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

export function findMessageSentByTimestamp(
  projection: ReplayProjection,
  messageId: MessageId,
  timestamp: Temporal.Instant,
): MessageSentEvent | undefined {
  return findLastIndexedEventAfter(
    projection.messageSentById.get(messageId) ?? [],
    -1,
    (event): event is MessageSentEvent =>
      Temporal.Instant.compare(event.timestamp, timestamp) === 0,
  );
}

export interface StreamEventProjection {
  started: StreamStartedEvent;
  chunks: IndexedEvent<StreamChunkEvent>[];
  closed?: IndexedEvent<StreamClosedEvent>;
  failed?: IndexedEvent<StreamFailedEvent>;
}

export function findStreamEventProjection(
  projection: ReplayProjection,
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
    closed: projection.streamClosedByStreamId.get(started.event.streamId),
    failed: projection.streamFailedByStreamId.get(started.event.streamId),
  };
}

export function findLastSleepStartedForCompleted(
  projection: ReplayProjection,
  completed: SleepCompletedEvent,
): SleepStartedEvent | undefined {
  const started = projection.startedSleep.get(completed.stepId);

  return started?.stepName === completed.stepName ? started : undefined;
}

export function findLastMessageWaitStartedForCompleted(
  projection: ReplayProjection,
  completed: MessageWaitCompletedEvent,
): MessageWaitStartedEvent | undefined {
  const started = projection.startedMessageWait.get(completed.stepId);

  return started?.stepName === completed.stepName && started.messageId === completed.messageId
    ? started
    : undefined;
}

export function findLastChildWorkflowStartedForTerminal(
  projection: ReplayProjection,
  terminal: ChildWorkflowCompletedEvent | ChildWorkflowFailedEvent,
): ChildWorkflowStartedEvent | undefined {
  return findLastIndexedEventAfter(
    projection.childWorkflowStartedByStepId.get(terminal.stepId) ?? [],
    -1,
    (event): event is ChildWorkflowStartedEvent =>
      childWorkflowTerminalMatchesStarted(terminal, event),
  );
}

export interface ChildWorkflowLifecycle {
  started?: ChildWorkflowStartedEvent;
  hasTerminalAfterStarted: boolean;
}

export function findChildWorkflowLifecycleForAttempt(
  projection: ReplayProjection,
  attempt: StepAttemptRecord,
): ChildWorkflowLifecycle {
  const started = projection.childWorkflowStartedByAttemptKey.get(childWorkflowAttemptKey(attempt));

  if (started === undefined) {
    return { hasTerminalAfterStarted: false };
  }

  return {
    started: started.event,
    hasTerminalAfterStarted: hasChildWorkflowTerminalAfterStarted(projection, started),
  };
}

function hasChildWorkflowTerminalAfterStarted(
  projection: ReplayProjection,
  started: IndexedEvent<ChildWorkflowStartedEvent>,
): boolean {
  return (
    findLastIndexedEventEntryAfter(
      projection.childWorkflowCompletedByStepId.get(started.event.stepId) ?? [],
      started.index,
      (event): event is ChildWorkflowCompletedEvent =>
        childWorkflowTerminalMatchesStarted(event, started.event),
    ) !== undefined ||
    findLastIndexedEventEntryAfter(
      projection.childWorkflowFailedByStepId.get(started.event.stepId) ?? [],
      started.index,
      (event): event is ChildWorkflowFailedEvent =>
        childWorkflowTerminalMatchesStarted(event, started.event),
    ) !== undefined
  );
}

export function activeMessageWaitStepIds(
  projection: ReplayProjection,
  messageId: MessageId,
): StepId[] {
  return [...(projection.activeMessageWaitsByMessageId.get(messageId)?.keys() ?? [])];
}

export function findLastMessageWaitStartedByNameAndMessageId(
  projection: ReplayProjection,
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
  projection: ReplayProjection,
  started: MessageWaitStartedEvent,
): MessageWaitCompletedEvent | MessageWaitFailedEvent | undefined {
  const startedIndex = projection.messageWaitStartedIndex.get(started);

  if (startedIndex === undefined) {
    return undefined;
  }

  const completed = findLastIndexedEventEntryAfter(
    projection.completedMessageWait.get(started.stepId) ?? [],
    startedIndex,
    (event): event is MessageWaitCompletedEvent =>
      event.stepName === started.stepName && event.messageId === started.messageId,
  );

  const failed = findLastIndexedEventEntryAfter(
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

export function findMessageSentByIdempotencyKey(
  projection: ReplayProjection,
  idempotencyKey: string | undefined,
): MessageSentEvent | undefined {
  return idempotencyKey === undefined
    ? undefined
    : projection.messageSentByIdempotencyKey.get(idempotencyKey);
}

export function findLastMessageSentById(
  projection: ReplayProjection,
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

function childWorkflowAttemptKey(event: ChildWorkflowStartedEvent | StepAttemptRecord): string {
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

function childWorkflowTerminalMatchesStarted(
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
