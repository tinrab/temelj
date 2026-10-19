import type { EventHandler, EventPattern } from "@temelj/event";
import type { StorageValue } from "@temelj/storage";

import type { CleanupRunsResult } from "./cleanup.ts";
import type { WorkflowErrorRecord } from "./error.ts";
import type {
  ChildWorkflowStartedEvent,
  EventRecord,
  MessageSentEvent,
  StreamEventKind,
} from "./events.ts";
import type { HookKind } from "./hook.ts";
import type { MessageId, RunId, StreamId, WorkerId } from "./ids.ts";
import type { WorkflowLifecycleEvent, RunRecord } from "./run.ts";
import type { ScheduleId, TickSchedulesResult } from "./schedule.ts";
import type { StepAttemptRecord } from "./step-attempts.ts";
import type { TelemetryContext } from "./telemetry.ts";

export interface DurableEventObservationEvent {
  readonly runId: RunId;
  readonly event: EventRecord;
  readonly events: readonly EventRecord[];
}

export interface StepAttemptObservationEvent {
  readonly runId: RunId;
  readonly attempt: StepAttemptRecord;
}

export interface MessageObservationEvent {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly timestamp?: Temporal.Instant;
  readonly traceContext?: TelemetryContext;
}

export interface ResumeObservationEvent {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly traceContext?: TelemetryContext;
}

export interface StreamObservationEvent {
  readonly runId: RunId;
  readonly streamId: StreamId;
  readonly streamName?: string;
  readonly eventKind: StreamEventKind;
  readonly timestamp: Temporal.Instant;
  readonly stepId: string;
  readonly stepName: string;
  readonly index?: number;
  readonly error?: WorkflowErrorRecord;
}

export interface ChildWorkflowStartedObservationEvent {
  readonly runId: RunId;
  readonly event: ChildWorkflowStartedEvent;
}

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
  readonly run?: RunRecord;
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

export interface ObservationEventMap {
  readonly "workflow:run-created": WorkflowLifecycleEvent;
  readonly "workflow:run-claimed": WorkflowLifecycleEvent;
  readonly "workflow:run-started": WorkflowLifecycleEvent;
  readonly "workflow:run-waiting": WorkflowLifecycleEvent;
  readonly "workflow:run-rescheduled": WorkflowLifecycleEvent;
  readonly "workflow:run-lease-released": WorkflowLifecycleEvent;
  readonly "workflow:run-manual-retry": WorkflowLifecycleEvent;
  readonly "workflow:run-permanently-failed": WorkflowLifecycleEvent;
  readonly "workflow:run-retrying": WorkflowLifecycleEvent;
  readonly "workflow:run-completed": WorkflowLifecycleEvent;
  readonly "workflow:run-failed": WorkflowLifecycleEvent;
  readonly "workflow:run-canceled": WorkflowLifecycleEvent;
  readonly "workflow:run-metadata-updated": WorkflowLifecycleEvent;
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

/** An observation name paired with its corresponding payload. */
export type ObservationEventArgs = {
  [Key in keyof ObservationEventMap]: [name: Key, payload: ObservationEventMap[Key]];
}[keyof ObservationEventMap];

export type ObservationEventPattern = EventPattern<ObservationEventMap>;

export type ObservationEventHandler<
  Pattern extends ObservationEventPattern = ObservationEventPattern,
> = EventHandler<ObservationEventMap, Pattern>;

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
  readonly emitRunEvent: (run: RunRecord, previousRun?: RunRecord) => void;
  readonly emitRunMetadataUpdated: (run: RunRecord, previousRun?: RunRecord) => void;
  readonly emitDurableEventAppended: (
    runId: RunId,
    event: EventRecord,
    events: readonly EventRecord[],
  ) => void;
  readonly emitMessageSent: (runId: RunId, event: MessageSentEvent) => void;
  readonly emitHookResumed: (
    kind: HookKind,
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
