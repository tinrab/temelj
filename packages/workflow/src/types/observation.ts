import type { EventHandler, EventPattern, Unsubscribe } from "@temelj/event";
import type { StorageValue } from "@temelj/storage";

import type { CleanupRunsResult } from "./cleanup.ts";
import type {
  ChildWorkflowStartedEvent,
  EventRecord,
  MessageSentEvent,
  StreamFailedError,
  StreamEventKind,
} from "./events.ts";
import type { MessageId } from "./message-id.ts";
import type { RunId, WorkflowLifecycleEvent, WorkflowRunRecord } from "./run.ts";
import type { ScheduleId, TickSchedulesResult } from "./schedule.ts";
import type { WorkflowStepAttemptRecord } from "./step-attempts.ts";
import type { StreamId } from "./stream-id.ts";
import type { TelemetryContext } from "./telemetry.ts";
import type { WorkerId } from "./worker-id.ts";

/** Describes the workflow run observation event contract. */
export type RunObservationEvent = WorkflowLifecycleEvent;

/** Describes the workflow durable event observation event contract. */
export interface DurableEventObservationEvent {
  readonly runId: RunId;
  readonly event: EventRecord;
  readonly events: readonly EventRecord[];
}

/** Describes the workflow step attempt observation event contract. */
export interface StepAttemptObservationEvent {
  readonly runId: RunId;
  readonly attempt: WorkflowStepAttemptRecord;
}

/** Describes the workflow message observation event contract. */
export interface MessageObservationEvent {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly timestamp?: Temporal.Instant;
  readonly traceContext?: TelemetryContext;
}

/** Describes the workflow resume observation event contract. */
export interface ResumeObservationEvent {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly traceContext?: TelemetryContext;
}

/** Describes the workflow stream observation event contract. */
export interface StreamObservationEvent {
  readonly runId: RunId;
  readonly streamId: StreamId;
  readonly streamName?: string;
  readonly eventKind: StreamEventKind;
  readonly timestamp: Temporal.Instant;
  readonly stepId: string;
  readonly stepName: string;
  readonly index?: number;
  readonly error?: StreamFailedError;
}

/** Describes a child workflow start observation event. */
export interface ChildWorkflowStartedObservationEvent {
  readonly runId: RunId;
  readonly event: ChildWorkflowStartedEvent;
}

/** Describes the workflow cleanup observation event contract. */
export interface CleanupObservationEvent {
  readonly result: CleanupRunsResult;
}

/** Describes worker-side operation observations that are not durable run transitions. */
export interface WorkerOperationObservationEvent {
  readonly workerId: WorkerId;
  readonly runId?: RunId;
  readonly operation: "poll" | "claim" | "heartbeat" | "lease_extension" | "lease_release";
  readonly status: "success" | "failure" | "claimed" | "empty";
  readonly timestamp: Temporal.Instant;
  readonly run?: WorkflowRunRecord;
  readonly error?: unknown;
}

/** Describes one recurring schedule fire that created a workflow run. */
export interface ScheduleRunCreatedObservationEvent {
  readonly scheduleId: ScheduleId;
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly fireAt: Temporal.Instant;
  readonly timestamp: Temporal.Instant;
}

/** Describes one recurring schedule tick operation. */
export interface ScheduleTickObservationEvent {
  readonly result: TickSchedulesResult;
  readonly timestamp: Temporal.Instant;
}

/** Describes the workflow observation event map contract. */
export interface ObservationEventMap {
  readonly "workflow:run-created": RunObservationEvent;
  readonly "workflow:run-claimed": RunObservationEvent;
  readonly "workflow:run-started": RunObservationEvent;
  readonly "workflow:run-waiting": RunObservationEvent;
  readonly "workflow:run-rescheduled": RunObservationEvent;
  readonly "workflow:run-lease-released": RunObservationEvent;
  readonly "workflow:run-manual-retry": RunObservationEvent;
  readonly "workflow:run-permanently-failed": RunObservationEvent;
  readonly "workflow:run-retrying": RunObservationEvent;
  readonly "workflow:run-completed": RunObservationEvent;
  readonly "workflow:run-failed": RunObservationEvent;
  readonly "workflow:run-canceled": RunObservationEvent;
  readonly "workflow:run-metadata-updated": RunObservationEvent;
  readonly "workflow:durable-event-appended": DurableEventObservationEvent;
  readonly "workflow:step-attempt-updated": StepAttemptObservationEvent;
  readonly "workflow:message-sent": MessageObservationEvent;
  readonly "workflow:hook-resumed": ResumeObservationEvent;
  readonly "workflow:webhook-resumed": ResumeObservationEvent;
  readonly "workflow:stream-updated": StreamObservationEvent;
  readonly "workflow:child-workflow-started": ChildWorkflowStartedObservationEvent;
  readonly "workflow:cleanup-completed": CleanupObservationEvent;
  readonly "workflow:retention-applied": CleanupObservationEvent;
  readonly "workflow:worker-operation": WorkerOperationObservationEvent;
  readonly "workflow:schedule-ticked": ScheduleTickObservationEvent;
  readonly "workflow:schedule-run-created": ScheduleRunCreatedObservationEvent;
}

/** Type used for workflow observation event pattern values. */
export type ObservationEventPattern = EventPattern<ObservationEventMap>;

/** Type used for workflow observation event handler values. */
export type ObservationEventHandler<
  Pattern extends ObservationEventPattern = ObservationEventPattern,
> = EventHandler<ObservationEventMap, Pattern>;

/** Type used for workflow observation unsubscribe values. */
export type ObservationUnsubscribe = Unsubscribe;

/** Internal emitter facade used to publish workflow observation events. */
export interface ObservationEmitter {
  readonly on: <Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ) => () => void;
  readonly once: <Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ) => () => void;
  readonly off: <Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ) => void;
  readonly listeners: {
    (): readonly ObservationEventHandler[];
    <Pattern extends ObservationEventPattern>(
      pattern: Pattern,
    ): readonly ObservationEventHandler<Pattern>[];
  };
  readonly clearListeners: (pattern?: ObservationEventPattern) => void;
  readonly listenerCount: (pattern?: ObservationEventPattern) => number;
  readonly emitRunEvent: (run: WorkflowRunRecord, previousRun?: WorkflowRunRecord) => void;
  readonly emitRunMetadataUpdated: (
    run: WorkflowRunRecord,
    previousRun?: WorkflowRunRecord,
  ) => void;
  readonly emitDurableEventAppended: (
    runId: RunId,
    event: EventRecord,
    events: readonly EventRecord[],
  ) => void;
  readonly emitMessageSent: (runId: RunId, event: MessageSentEvent) => void;
  readonly emitHookResumed: (
    runId: RunId,
    messageId: MessageId,
    payload: StorageValue | undefined,
    traceContext: TelemetryContext | undefined,
  ) => void;
  readonly emitWebhookResumed: (
    runId: RunId,
    messageId: MessageId,
    payload: StorageValue | undefined,
    traceContext: TelemetryContext | undefined,
  ) => void;
  readonly emitChildWorkflowStarted: (event: ChildWorkflowStartedObservationEvent) => void;
  readonly emitCleanupCompleted: (result: CleanupRunsResult) => void;
  readonly emitRetentionApplied: (result: CleanupRunsResult) => void;
  readonly emitWorkerOperation: (event: WorkerOperationObservationEvent) => void;
  readonly emitScheduleTicked: (event: ScheduleTickObservationEvent) => void;
  readonly emitScheduleRunCreated: (event: ScheduleRunCreatedObservationEvent) => void;
}
