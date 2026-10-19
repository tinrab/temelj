import { deepEquals } from "@temelj/value";

import type {
  EventRecord,
  SleepStartedEvent,
  SleepCompletedEvent,
  StepStartedEvent,
  StepCompletedEvent,
  StepFailedEvent,
  ChildWorkflowStartedEvent,
  ChildWorkflowCompletedEvent,
  ChildWorkflowFailedEvent,
  MessageSendStartedEvent,
  MessageSendCompletedEvent,
  MessageSendFailedEvent,
  MessageSentEvent,
  MessageWaitStartedEvent,
  MessageWaitCompletedEvent,
  MessageWaitFailedEvent,
  StreamChunkEvent,
  StreamClosedEvent,
  DeterministicValueRecordedEvent,
  StreamFailedEvent,
  StreamStartedEvent,
  MetadataSetEvent,
} from "../types/events.ts";
import type { MessageId, StreamIdOrName, StepId } from "../types/ids.ts";
import type { StepIdentity, StepType } from "../types/run.ts";
import type { StepAttemptRecord } from "../types/step-attempts.ts";

import { WorkflowReplayDivergenceError } from "../errors/mod.ts";
import {
  appendReplayProjectionEvents,
  activeMessageWaitStepIds,
  createReplayProjection,
  findLastMessageSentById,
  findMessageSentByIdempotencyKey,
  findMessageSentForWait,
  findLastIndexedEventAfter,
  findLastMessageWaitStartedByNameAndMessageId,
  findLastMessageWaitTerminalAfterStarted,
  findLastMessageWaitStartedForCompleted,
  findLastSleepStartedForCompleted,
  findLastChildWorkflowStartedForTerminal,
  findChildWorkflowLifecycleForAttempt,
  findMessageSentByTimestamp,
  findStreamEventProjection,
  type ChildWorkflowLifecycle,
  type ReplayProjection,
  type StreamEventProjection,
} from "./replay-projection.ts";
import { createStepSequencer, StepSequencer } from "./sequencer.ts";
import {
  requireWorkflowStartedEventsAreUnique,
  requireWorkflowTerminalEventsAreUnique,
  requireWorkflowTerminalEventsHaveStartedEvents,
} from "./validator.ts";

export { applyStepAttemptEvent } from "./projection.ts";

export { createTimeline } from "./timeline.ts";

export { stepAttemptKey } from "../store-keys.ts";

export type { StepIdentity } from "../types/run.ts";

export type { StreamEventProjection } from "./replay-projection.ts";

export class History {
  readonly #events: EventRecord[];
  readonly #sequencer: StepSequencer;
  #projection: ReplayProjection;
  #appendQueue: Promise<void> = Promise.resolve();

  constructor(events: readonly EventRecord[]) {
    this.#events = [...events];
    this.#sequencer = createStepSequencer(events);
    this.#projection = createReplayProjection(this.#events);
  }

  get events(): readonly EventRecord[] {
    return this.#events;
  }

  nextStep<TType extends StepType>(type: TType, name: string): StepIdentity<TType> {
    return this.#sequencer.next(type, name);
  }

  async append(
    appendEvents: () => Promise<readonly EventRecord[]>,
  ): Promise<readonly EventRecord[]> {
    let appendedEvents: readonly EventRecord[] = [];

    const operation = this.#appendQueue.then(async () => {
      appendedEvents = await appendEvents();
      this.#replaceEvents(appendedEvents);
    });

    this.#appendQueue = operation.catch(() => {});
    await operation;

    return appendedEvents;
  }

  completedStep(stepId: StepId): StepCompletedEvent | undefined {
    return this.#projection.completedStep.get(stepId);
  }

  startedStep(stepId: StepId): StepStartedEvent | undefined {
    return this.#projection.startedStep.get(stepId);
  }

  failedSteps(stepId: StepId): readonly StepFailedEvent[] {
    return this.#projection.failedSteps.get(stepId) ?? [];
  }

  unstartedFailedStep(stepId: StepId): StepFailedEvent | undefined {
    return this.#projection.unstartedFailedStep.get(stepId);
  }

  metadataSet(stepId: StepId): MetadataSetEvent | undefined {
    return this.#projection.metadataSet.get(stepId);
  }

  attributesSet(
    stepId: StepId,
  ): Extract<EventRecord, { readonly kind: "attributes_set" }> | undefined {
    return this.#projection.attributesSet.get(stepId);
  }

  startedStepCount(stepId: StepId): number {
    return this.#projection.startedStepAttempts.get(stepId)?.length ?? 0;
  }

  nextStepAttempt(stepId: StepId): number {
    if (this.#projection.invalidStartedStepAttempt.has(stepId)) {
      WorkflowReplayDivergenceError.atStep(
        stepId,
        `recorded run step ${stepId} has an invalid attempt number`,
      );
    }

    return this.#projection.nextStepAttemptByStepId.get(stepId) ?? 1;
  }

  totalStartedStepCount(): number {
    return this.#projection.totalStartedStepCount;
  }

  hasPriorWorkflowStart(): boolean {
    return this.#projection.workflowStartedCount > 1;
  }

  startedSleep(stepId: StepId): SleepStartedEvent | undefined {
    return this.#projection.startedSleep.get(stepId);
  }

  completedSleep(stepId: StepId): SleepCompletedEvent | undefined {
    return this.#projection.completedSleep.get(stepId);
  }

  startedSleepForCompleted(completed: SleepCompletedEvent): SleepStartedEvent | undefined {
    return findLastSleepStartedForCompleted(this.#projection, completed);
  }

  startedChildWorkflow(stepId: StepId): ChildWorkflowStartedEvent | undefined {
    return this.#projection.startedChildWorkflow.get(stepId);
  }

  completedChildWorkflow(stepId: StepId): ChildWorkflowCompletedEvent | undefined {
    return this.#projection.completedChildWorkflow.get(stepId);
  }

  failedChildWorkflow(stepId: StepId): ChildWorkflowFailedEvent | undefined {
    return this.#projection.failedChildWorkflow.get(stepId);
  }

  startedChildWorkflowForTerminal(
    terminal: ChildWorkflowCompletedEvent | ChildWorkflowFailedEvent,
  ): ChildWorkflowStartedEvent | undefined {
    return findLastChildWorkflowStartedForTerminal(this.#projection, terminal);
  }

  childWorkflowLifecycleForAttempt(attempt: StepAttemptRecord): ChildWorkflowLifecycle {
    return findChildWorkflowLifecycleForAttempt(this.#projection, attempt);
  }

  startedMessageWait(stepId: StepId): MessageWaitStartedEvent | undefined {
    return this.#projection.startedMessageWait.get(stepId);
  }

  startedMessageWaitForCompleted(
    completed: MessageWaitCompletedEvent,
  ): MessageWaitStartedEvent | undefined {
    return findLastMessageWaitStartedForCompleted(this.#projection, completed);
  }

  completedMessageWait(stepId: StepId): MessageWaitCompletedEvent | undefined {
    return findLastIndexedEventAfter(
      this.#projection.completedMessageWait.get(stepId) ?? [],
      this.#projection.latestMessageWaitStartedIndex.get(stepId) ?? -1,
      (event): event is MessageWaitCompletedEvent => event.timestamp instanceof Temporal.Instant,
    );
  }

  failedMessageWait(stepId: StepId): MessageWaitFailedEvent | undefined {
    return findLastIndexedEventAfter(
      this.#projection.failedMessageWait.get(stepId) ?? [],
      this.#projection.latestMessageWaitStartedIndex.get(stepId) ?? -1,
      (event): event is MessageWaitFailedEvent => event.timestamp instanceof Temporal.Instant,
    );
  }

  latestMessageWaitStartedByNameAndMessageId(
    stepName: string,
    messageId: MessageId,
  ): MessageWaitStartedEvent | undefined {
    return findLastMessageWaitStartedByNameAndMessageId(this.#projection, stepName, messageId);
  }

  latestMessageWaitTerminalAfterStarted(
    started: MessageWaitStartedEvent,
  ): MessageWaitCompletedEvent | MessageWaitFailedEvent | undefined {
    return findLastMessageWaitTerminalAfterStarted(this.#projection, started);
  }

  messageForWait(
    messageId: MessageId,
    stepId: StepId,
    timeoutAt: Temporal.Instant | undefined,
  ): MessageSentEvent | undefined {
    return findMessageSentForWait(this.#projection, messageId, stepId, timeoutAt);
  }

  activeMessageWaitStepIds(messageId: MessageId): readonly StepId[] {
    return activeMessageWaitStepIds(this.#projection, messageId);
  }

  messageForSend(
    messageId: MessageId,
    idempotencyKey: string | undefined,
  ): MessageSentEvent | undefined {
    return idempotencyKey === undefined
      ? findLastMessageSentById(this.#projection, messageId)
      : findMessageSentByIdempotencyKey(this.#projection, idempotencyKey);
  }

  messageByIdempotencyKey(idempotencyKey: string): MessageSentEvent | undefined {
    return findMessageSentByIdempotencyKey(this.#projection, idempotencyKey);
  }

  latestMessagesByIdempotencyKey(): readonly MessageSentEvent[] {
    return [...this.#projection.latestMessageSentByIdempotencyKey.values()];
  }

  messageSentByTimestamp(
    messageId: MessageId,
    timestamp: Temporal.Instant,
  ): MessageSentEvent | undefined {
    return findMessageSentByTimestamp(this.#projection, messageId, timestamp);
  }

  startedMessageSend(stepId: StepId): MessageSendStartedEvent | undefined {
    return this.#projection.startedMessageSend.get(stepId);
  }

  completedMessageSend(stepId: StepId): MessageSendCompletedEvent | undefined {
    return this.#projection.completedMessageSend.get(stepId);
  }

  failedMessageSend(stepId: StepId): MessageSendFailedEvent | undefined {
    return this.#projection.failedMessageSend.get(stepId);
  }

  startedStream(stepId: StepId): StreamStartedEvent | undefined {
    return this.#projection.startedStream.get(stepId);
  }

  streamChunks(stepId: StepId): readonly StreamChunkEvent[] {
    return this.#projection.streamChunks.get(stepId) ?? [];
  }

  streamChunk(stepId: StepId, index: number): StreamChunkEvent | undefined {
    return this.#projection.streamChunkByIndex.get(stepId)?.get(index);
  }

  closedStream(stepId: StepId): StreamClosedEvent | undefined {
    return this.#projection.closedStream.get(stepId);
  }

  failedStream(stepId: StepId): StreamFailedEvent | undefined {
    return this.#projection.failedStream.get(stepId);
  }

  streamProjection(streamIdOrName: StreamIdOrName): StreamEventProjection | undefined {
    return findStreamEventProjection(this.#projection, streamIdOrName);
  }

  deterministicValue(stepId: StepId): DeterministicValueRecordedEvent | undefined {
    return this.#projection.deterministicValue.get(stepId);
  }

  hasStartedEventBeforeTerminalEvent(event: EventRecord): boolean {
    return this.#projection.terminalStartedBefore.has(event);
  }

  requireTerminalEventsHaveStartedEvents(): void {
    requireWorkflowTerminalEventsHaveStartedEvents(this.#events);
  }

  requireTerminalEventsAreUnique(): void {
    requireWorkflowTerminalEventsAreUnique(this.#events);
  }

  requireStartedEventsAreUnique(): void {
    requireWorkflowStartedEventsAreUnique(this.#events);
  }

  requireReplayConsumed(): void {
    this.#sequencer.requireConsumed();
  }

  isReplayConsumed(): boolean {
    return this.#sequencer.isConsumed();
  }

  #replaceEvents(events: readonly EventRecord[]): void {
    const previousLength = this.#events.length;

    if (eventsPreservePrefix(this.#events, events, previousLength)) {
      this.#events.splice(0, this.#events.length, ...events);
      appendReplayProjectionEvents(this.#projection, events.slice(previousLength), previousLength);

      return;
    }

    this.#events.splice(0, this.#events.length, ...events);
    this.#projection = createReplayProjection(this.#events);
  }
}

function eventsPreservePrefix(
  current: readonly EventRecord[],
  next: readonly EventRecord[],
  prefixLength: number,
): boolean {
  return (
    next.length >= prefixLength && current.every((event, index) => deepEquals(event, next[index]))
  );
}
