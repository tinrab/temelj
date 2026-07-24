import { deepEquals } from "@temelj/value";

import type {
  EventRecord,
  SleepStartedEvent,
  SleepCompletedEvent,
  WorkflowStepStartedEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepFailedEvent,
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
import type { MessageId } from "../types/message.ts";
import type { WorkflowStepIdentity, WorkflowStepType } from "../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../types/step-attempts.ts";
import type { StreamIdOrName } from "../types/stream-id.ts";

import { WorkflowReplayDivergenceError } from "../errors/mod.ts";
import { StepId } from "../types/step.ts";
import {
  appendWorkflowReplayProjectionEvents,
  activeMessageWaitStepIds,
  createWorkflowReplayProjection,
  findLastWorkflowMessageSentById,
  findWorkflowMessageSentByIdempotencyKey,
  findWorkflowMessageSentForWait,
  findLastIndexedWorkflowEventAfter,
  findLastMessageWaitStartedByNameAndMessageId,
  findLastMessageWaitTerminalAfterStarted,
  findLastMessageWaitStartedForCompleted,
  findLastWorkflowSleepStartedForCompleted,
  findLastWorkflowChildWorkflowStartedForTerminal,
  findWorkflowChildWorkflowLifecycleForAttempt,
  findWorkflowMessageSentByTimestamp,
  findStreamEventProjection,
  type WorkflowChildWorkflowLifecycle,
  type WorkflowReplayProjection,
  type StreamEventProjection,
} from "./replay-projection.ts";
import { createWorkflowStepSequencer, WorkflowStepSequencer } from "./sequencer.ts";
import {
  requireWorkflowStartedEventsAreUnique,
  requireWorkflowTerminalEventsAreUnique,
  requireWorkflowTerminalEventsHaveStartedEvents,
} from "./validator.ts";
export { applyWorkflowStepAttemptEvent } from "./projection.ts";
export { createTimeline } from "./timeline.ts";
export { makeWorkflowStepAttemptKey as workflowStepAttemptKey } from "./attempt-key.ts";
export type { WorkflowStepIdentity } from "../types/run.ts";
export type { StreamEventProjection } from "./replay-projection.ts";

/** Runtime class for workflow history. */
export class WorkflowHistory {
  readonly #events: EventRecord[];
  readonly #sequencer: WorkflowStepSequencer;
  #projection: WorkflowReplayProjection;
  #appendQueue: Promise<void> = Promise.resolve();

  constructor(events: readonly EventRecord[]) {
    this.#events = [...events];
    this.#sequencer = createWorkflowStepSequencer(events);
    this.#projection = createWorkflowReplayProjection(this.#events);
  }

  get events(): readonly EventRecord[] {
    return this.#events;
  }

  nextStep<TType extends WorkflowStepType>(type: TType, name: string): WorkflowStepIdentity<TType> {
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

  completedStep(stepId: StepId): WorkflowStepCompletedEvent | undefined {
    return this.#projection.completedStep.get(stepId);
  }

  startedStep(stepId: StepId): WorkflowStepStartedEvent | undefined {
    return this.#projection.startedStep.get(stepId);
  }

  failedSteps(stepId: StepId): readonly WorkflowStepFailedEvent[] {
    return this.#projection.failedSteps.get(stepId) ?? [];
  }

  unstartedFailedStep(stepId: StepId): WorkflowStepFailedEvent | undefined {
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
      WorkflowReplayDivergenceError.diverged(
        `recorded run step ${stepId} has an invalid attempt number`,
        {
          expectedStepId: stepId,
          actualStepId: stepId,
        },
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
    return findLastWorkflowSleepStartedForCompleted(this.#projection, completed);
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
    return findLastWorkflowChildWorkflowStartedForTerminal(this.#projection, terminal);
  }

  childWorkflowLifecycleForAttempt(
    attempt: WorkflowStepAttemptRecord,
  ): WorkflowChildWorkflowLifecycle {
    return findWorkflowChildWorkflowLifecycleForAttempt(this.#projection, attempt);
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
    return findLastIndexedWorkflowEventAfter(
      this.#projection.completedMessageWait.get(stepId) ?? [],
      this.#projection.latestMessageWaitStartedIndex.get(stepId) ?? -1,
      (event): event is MessageWaitCompletedEvent => event.timestamp instanceof Temporal.Instant,
    );
  }

  failedMessageWait(stepId: StepId): MessageWaitFailedEvent | undefined {
    return findLastIndexedWorkflowEventAfter(
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
    return findWorkflowMessageSentForWait(this.#projection, messageId, stepId, timeoutAt);
  }

  activeMessageWaitStepIds(messageId: MessageId): readonly StepId[] {
    return activeMessageWaitStepIds(this.#projection, messageId);
  }

  messageForSend(
    messageId: MessageId,
    idempotencyKey: string | undefined,
  ): MessageSentEvent | undefined {
    return idempotencyKey === undefined
      ? findLastWorkflowMessageSentById(this.#projection, messageId)
      : findWorkflowMessageSentByIdempotencyKey(this.#projection, idempotencyKey);
  }

  messageByIdempotencyKey(idempotencyKey: string): MessageSentEvent | undefined {
    return findWorkflowMessageSentByIdempotencyKey(this.#projection, idempotencyKey);
  }

  latestMessagesByIdempotencyKey(): readonly MessageSentEvent[] {
    return [...this.#projection.latestMessageSentByIdempotencyKey.values()];
  }

  messageSentByTimestamp(
    messageId: MessageId,
    timestamp: Temporal.Instant,
  ): MessageSentEvent | undefined {
    return findWorkflowMessageSentByTimestamp(this.#projection, messageId, timestamp);
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
      appendWorkflowReplayProjectionEvents(
        this.#projection,
        events.slice(previousLength),
        previousLength,
      );
      return;
    }
    this.#events.splice(0, this.#events.length, ...events);
    this.#projection = createWorkflowReplayProjection(this.#events);
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
