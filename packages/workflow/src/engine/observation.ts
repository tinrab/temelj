import type { StorageValue } from "@temelj/storage";

import { createPubSub } from "@temelj/event";

import type { CleanupRunsResult } from "../types/cleanup.ts";
import type { EventRecord, MessageSentEvent } from "../types/events.ts";
import type { MessageId } from "../types/message-id.ts";
import type {
  ChildWorkflowStartedObservationEvent,
  ObservationEmitter as ObservationEmitterContract,
  ObservationEventHandler,
  ObservationEventMap,
  ObservationEventPattern,
  RunObservationEvent,
  ScheduleRunCreatedObservationEvent,
  ScheduleTickObservationEvent,
  WorkerOperationObservationEvent,
} from "../types/observation.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { Telemetry, TelemetryContext } from "../types/telemetry.ts";

import { getWorkflowEventStepAttemptKey } from "../events/descriptors.ts";
import { workflowStepAttemptKey } from "../history/mod.ts";
import { createWorkflowStepAttempts } from "../history/step-attempts.ts";
import { observeTelemetry } from "../telemetry.ts";

type WorkflowObservationEmit = <Key extends keyof ObservationEventMap>(
  event: Key,
  payload: ObservationEventMap[Key],
) => unknown;

export function createObservationEmitter(telemetry?: Telemetry): ObservationEmitterContract {
  return new ObservationEmitter(telemetry);
}

export class ObservationEmitter implements ObservationEmitterContract {
  readonly #events = createPubSub<ObservationEventMap>();
  readonly #telemetry?: Telemetry;
  readonly #emit: WorkflowObservationEmit = (event, payload) => {
    this.#events.emit(event, payload);
    observeTelemetry(this.#telemetry, event, payload);
  };

  constructor(telemetry?: Telemetry) {
    this.#telemetry = telemetry;
    this.on = this.on.bind(this);
    this.once = this.once.bind(this);
    this.off = this.off.bind(this);
    this.listeners = this.listeners.bind(this);
    this.clearListeners = this.clearListeners.bind(this);
    this.listenerCount = this.listenerCount.bind(this);
    this.emitRunEvent = this.emitRunEvent.bind(this);
    this.emitRunMetadataUpdated = this.emitRunMetadataUpdated.bind(this);
    this.emitDurableEventAppended = this.emitDurableEventAppended.bind(this);
    this.emitMessageSent = this.emitMessageSent.bind(this);
    this.emitHookResumed = this.emitHookResumed.bind(this);
    this.emitWebhookResumed = this.emitWebhookResumed.bind(this);
    this.emitChildWorkflowStarted = this.emitChildWorkflowStarted.bind(this);
    this.emitCleanupCompleted = this.emitCleanupCompleted.bind(this);
    this.emitRetentionApplied = this.emitRetentionApplied.bind(this);
    this.emitWorkerOperation = this.emitWorkerOperation.bind(this);
    this.emitScheduleTicked = this.emitScheduleTicked.bind(this);
    this.emitScheduleRunCreated = this.emitScheduleRunCreated.bind(this);
  }

  on<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): () => void {
    return this.#events.on(pattern, handler);
  }

  once<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): () => void {
    return this.#events.once(pattern, handler);
  }

  off<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): void {
    this.#events.off(pattern, handler);
  }

  clearListeners(pattern?: ObservationEventPattern): void {
    this.#events.clear(pattern);
  }

  listenerCount(pattern?: ObservationEventPattern): number {
    return this.#events.listenerCount(pattern);
  }

  listeners(): readonly ObservationEventHandler[];
  listeners<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
  ): readonly ObservationEventHandler<Pattern>[];
  listeners(pattern?: ObservationEventPattern): readonly ObservationEventHandler[] {
    return pattern === undefined ? this.#events.listeners() : this.#events.listeners(pattern);
  }

  emitRunEvent(run: WorkflowRunRecord, previousRun?: WorkflowRunRecord): void {
    emitRunEvent(this.#emit, run, previousRun);
  }

  emitRunMetadataUpdated(run: WorkflowRunRecord, previousRun?: WorkflowRunRecord): void {
    this.#emit("workflow:run-metadata-updated", makeRunObservationEvent(run, previousRun));
  }

  emitDurableEventAppended(
    runId: RunId,
    event: EventRecord,
    appendedEvents: readonly EventRecord[],
  ): void {
    this.#emit("workflow:durable-event-appended", {
      runId,
      event,
      events: appendedEvents,
    });
    emitStepAttemptUpdated(this.#emit, runId, event, appendedEvents);
    emitStreamUpdated(this.#emit, runId, event);
  }

  emitMessageSent(runId: RunId, event: MessageSentEvent): void {
    this.#emit("workflow:message-sent", {
      runId,
      messageId: event.messageId,
      payload: event.payload,
      timestamp: event.timestamp,
      ...(event.telemetryContext === undefined ? {} : { traceContext: event.telemetryContext }),
    });
  }

  emitHookResumed(
    runId: RunId,
    messageId: MessageId,
    payload: StorageValue | undefined,
    traceContext: TelemetryContext | undefined,
  ): void {
    this.#emit("workflow:hook-resumed", {
      runId,
      messageId,
      ...(payload === undefined ? {} : { payload }),
      ...(traceContext === undefined ? {} : { traceContext }),
    });
  }

  emitWebhookResumed(
    runId: RunId,
    messageId: MessageId,
    payload: StorageValue | undefined,
    traceContext: TelemetryContext | undefined,
  ): void {
    this.#emit("workflow:webhook-resumed", {
      runId,
      messageId,
      ...(payload === undefined ? {} : { payload }),
      ...(traceContext === undefined ? {} : { traceContext }),
    });
  }

  emitChildWorkflowStarted(event: ChildWorkflowStartedObservationEvent): void {
    this.#emit("workflow:child-workflow-started", event);
  }

  emitCleanupCompleted(result: CleanupRunsResult): void {
    this.#emit("workflow:cleanup-completed", { result });
  }

  emitRetentionApplied(result: CleanupRunsResult): void {
    this.#emit("workflow:retention-applied", { result });
  }

  emitWorkerOperation(event: WorkerOperationObservationEvent): void {
    this.#emit("workflow:worker-operation", event);
  }

  emitScheduleTicked(event: ScheduleTickObservationEvent): void {
    this.#emit("workflow:schedule-ticked", event);
  }

  emitScheduleRunCreated(event: ScheduleRunCreatedObservationEvent): void {
    this.#emit("workflow:schedule-run-created", event);
  }
}

function emitStepAttemptUpdated(
  emit: WorkflowObservationEmit,
  runId: RunId,
  event: EventRecord,
  events: readonly EventRecord[],
): void {
  let key: string | undefined;
  try {
    key = getWorkflowEventStepAttemptKey(event);
  } catch {
    return;
  }
  if (key === undefined) {
    return;
  }
  const attempts = createWorkflowStepAttempts(runId, events);
  const attempt = attempts.find(
    (current) => workflowStepAttemptKey(current.stepId, current.attempt) === key,
  );
  if (attempt === undefined) {
    return;
  }
  emit("workflow:step-attempt-updated", { runId, attempt });
}

function emitStreamUpdated(emit: WorkflowObservationEmit, runId: RunId, event: EventRecord): void {
  if (
    event.kind !== "stream_started" &&
    event.kind !== "stream_chunk" &&
    event.kind !== "stream_closed" &&
    event.kind !== "stream_failed"
  ) {
    return;
  }
  emit("workflow:stream-updated", {
    runId,
    streamId: event.streamId,
    streamName: event.stepName,
    eventKind: event.kind,
    timestamp: event.timestamp,
    stepId: event.stepId,
    stepName: event.stepName,
    ...(event.kind === "stream_chunk" ? { index: event.index } : {}),
    ...(event.kind === "stream_failed" ? { error: event.error } : {}),
  });
}

function emitRunEvent(
  emit: WorkflowObservationEmit,
  run: WorkflowRunRecord,
  previousRun: WorkflowRunRecord | undefined,
): void {
  const payload = makeRunObservationEvent(run, previousRun);
  switch (run.lastTransitionReason) {
    case "created":
      emit("workflow:run-created", payload);
      break;
    case "claimed":
    case "reclaimed":
      emit("workflow:run-claimed", payload);
      break;
    case "started":
      emit("workflow:run-started", payload);
      break;
    case "waiting":
    case "missing_implementation":
      emit("workflow:run-waiting", payload);
      break;
    case "rescheduled":
      emit("workflow:run-rescheduled", payload);
      break;
    case "lease_released":
      emit("workflow:run-lease-released", payload);
      break;
    case "manual_retry":
      emit("workflow:run-manual-retry", payload);
      break;
    case "permanent_failure":
      emit("workflow:run-permanently-failed", payload);
      break;
    case "retry":
      emit("workflow:run-retrying", payload);
      break;
    case "completed":
      emit("workflow:run-completed", payload);
      break;
    case "failed":
    case "deadline":
      emit("workflow:run-failed", payload);
      break;
    case "canceled":
      emit("workflow:run-canceled", payload);
      break;
  }
}

function makeRunObservationEvent(
  run: WorkflowRunRecord,
  previousRun: WorkflowRunRecord | undefined,
): RunObservationEvent {
  return {
    run,
    previousRun,
    status: run.status,
    reason: run.lastTransitionReason,
    timestamp: run.lastTransitionAt,
    workflowName: run.workflowName,
    ...(run.workflowVersion === undefined ? {} : { workflowVersion: run.workflowVersion }),
  };
}
