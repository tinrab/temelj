import type { StorageValue } from "@temelj/storage";

import type { WorkflowErrorRecord } from "./error.ts";
import type { MessageId, RunId, StepId, StreamId } from "./ids.ts";
import type { WorkflowAttributeValue, StepType } from "./run.ts";
import type { ChildWorkflowCancellationPolicy } from "./step.ts";
import type { TelemetryContext } from "./telemetry.ts";

/** Discriminant values for every durable workflow event record. */
export type EventKind =
  | RunEventKind
  | StepEventKind
  | SleepEventKind
  | ChildWorkflowEventKind
  | MessageEventKind
  | StreamEventKind
  | DataEventKind
  | DeterministicEventKind;

/** Names of fields carried by durable event variants. */
export type EventFieldName<TEvent extends EventRecord = EventRecord> = TEvent extends EventRecord
  ? keyof TEvent
  : never;

/** Values carried by fields of durable event variants. */
export type EventFieldValue<TEvent extends EventRecord = EventRecord> = TEvent extends EventRecord
  ? TEvent[keyof TEvent]
  : never;

/** Metadata describing how an event participates in cleanup and step-attempt materialization. */
export interface EventDescriptor {
  readonly kind: EventKind;
  readonly category: EventDescriptorCategory;
  readonly cleanup: boolean;
  readonly stepType?: StepType;
  readonly stepAttempt?: EventDescriptorStepAttempt;
  readonly terminalStepAttempt?: boolean;
  readonly startedEventType?: EventKind;
  readonly startedEventMatchFields?: readonly EventFieldName[];
  readonly identityFields?: readonly EventFieldName[];
  readonly valueIdentityFields?: readonly EventFieldName[];
  readonly stringListIdentityFields?: readonly EventFieldName[];
}

type EventDescriptorCategory =
  | "workflow"
  | "step"
  | "sleep"
  | "child_workflow"
  | "message"
  | "stream"
  | "deterministic"
  | "metadata";

/** How an event maps to a materialized step attempt. */
type EventDescriptorStepAttempt = "event" | "single";

/** Event kinds emitted for workflow lifecycle transitions. */
export type RunEventKind = "workflow_started" | "workflow_completed" | "workflow_failed";

/** Event kinds emitted for durable task attempts. */
export type StepEventKind = "step_started" | "step_completed" | "step_failed";

export type SleepEventKind = "sleep_started" | "sleep_completed";

/** Event kinds emitted while starting and observing child workflows. */
export type ChildWorkflowEventKind =
  | "child_workflow_started"
  | "child_workflow_completed"
  | "child_workflow_failed";

/** Event kinds emitted for message sends and waits. */
export type MessageEventKind =
  | "message_sent"
  | "message_send_started"
  | "message_send_completed"
  | "message_send_failed"
  | "message_wait_started"
  | "message_wait_completed"
  | "message_wait_failed";

export type StreamEventKind = "stream_started" | "stream_chunk" | "stream_closed" | "stream_failed";

/** Event kinds emitted when workflow metadata or attributes change. */
export type DataEventKind = "metadata_set" | "attributes_set";

/** Event kind emitted when a deterministic value is recorded for replay. */
export type DeterministicEventKind = "deterministic_value_recorded";

/** Union of all persisted workflow event records. */
export type EventRecord =
  | WorkflowStartedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | SleepStartedEvent
  | SleepCompletedEvent
  | ChildWorkflowStartedEvent
  | ChildWorkflowCompletedEvent
  | ChildWorkflowFailedEvent
  | MessageSentEvent
  | MessageSendStartedEvent
  | MessageSendCompletedEvent
  | MessageSendFailedEvent
  | MessageWaitStartedEvent
  | MessageWaitCompletedEvent
  | MessageWaitFailedEvent
  | MetadataSetEvent
  | AttributesSetEvent
  | StreamStartedEvent
  | StreamChunkEvent
  | StreamClosedEvent
  | StreamFailedEvent
  | DeterministicValueRecordedEvent;

/** Event recorded when a durable task attempt starts. */
export interface StepStartedEvent extends CountedAttemptedStepEvent {
  readonly kind: "step_started";
  readonly timeoutAt?: Temporal.Instant;
}

/** Event recorded when a durable task attempt completes. */
export interface StepCompletedEvent extends AttemptedStepEvent {
  readonly kind: "step_completed";
  readonly result?: StorageValue;
}

/** Event recorded when a durable task attempt fails. */
export interface StepFailedEvent extends AttemptedStepEvent {
  readonly kind: "step_failed";
  readonly error: WorkflowErrorRecord;
}

export interface SleepStartedEvent extends CountedStepEvent {
  readonly kind: "sleep_started";
  readonly until: Temporal.Instant;
  readonly duration?: Temporal.Duration;
}

export interface SleepCompletedEvent extends StepEvent {
  readonly kind: "sleep_completed";
}

export interface ChildWorkflowStartedEvent extends CountedAttemptedStepEvent {
  readonly kind: "child_workflow_started";
  readonly childRunId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly cancellation?: ChildWorkflowCancellationPolicy;
  readonly input?: StorageValue;
  readonly idempotencyKey?: string;
  readonly timeoutAt?: Temporal.Instant;
}

export interface ChildWorkflowCompletedEvent extends AttemptedStepEvent {
  readonly kind: "child_workflow_completed";
  readonly childRunId: RunId;
  readonly result?: StorageValue;
}

export interface ChildWorkflowFailedEvent extends AttemptedStepEvent {
  readonly kind: "child_workflow_failed";
  readonly childRunId: RunId;
  readonly error: WorkflowErrorRecord;
}

/** Event recorded when an external messageId is accepted for a run. */
export interface MessageSentEvent extends TimestampedEvent {
  readonly kind: "message_sent";
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly waiterStepIds?: readonly StepId[];
  readonly idempotencyKey?: string;
  readonly telemetryContext?: TelemetryContext;
}

/** Event recorded when a workflow starts sending a messageId to another run. */
export interface MessageSendStartedEvent extends CountedStepEvent {
  readonly kind: "message_send_started";
  readonly targetRunId: RunId;
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly idempotencyKey?: string;
}

export interface MessageSendCompletedEvent extends StepEvent {
  readonly kind: "message_send_completed";
  readonly targetRunId: RunId;
  readonly messageId: MessageId;
}

export interface MessageSendFailedEvent extends StepEvent {
  readonly kind: "message_send_failed";
  readonly targetRunId: RunId;
  readonly messageId: MessageId;
  readonly error: WorkflowErrorRecord;
}

export interface MessageWaitStartedEvent extends CountedStepEvent {
  readonly kind: "message_wait_started";
  readonly messageId: MessageId;
  readonly source?: MessageWaitSource;
  readonly timeoutAt?: Temporal.Instant;
}

export interface MessageWaitCompletedEvent extends StepEvent {
  readonly kind: "message_wait_completed";
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly messageTimestamp: Temporal.Instant;
  readonly telemetryContext?: TelemetryContext;
}

export interface MessageWaitFailedEvent extends StepEvent {
  readonly kind: "message_wait_failed";
  readonly messageId: MessageId;
  readonly error: WorkflowErrorRecord;
}

/** Event recorded when workflow run metadata is replaced. */
export interface MetadataSetEvent extends CountedStepEvent {
  readonly kind: "metadata_set";
  readonly metadata: StorageValue;
}

export interface AttributesSetEvent extends CountedStepEvent {
  readonly kind: "attributes_set";
  readonly attributes?: Readonly<Record<string, WorkflowAttributeValue>>;
  readonly removeAttributes?: readonly string[];
}

/** Event recorded when a durable stream is opened. */
export interface StreamStartedEvent extends CountedStepEvent {
  readonly kind: "stream_started";
  readonly streamId: StreamId;
  readonly contentType?: string;
  readonly metadata?: StorageValue;
}

export interface StreamChunkEvent extends StepEvent {
  readonly kind: "stream_chunk";
  readonly streamId: StreamId;
  readonly index: number;
  readonly chunk?: StorageValue;
}

export interface StreamClosedEvent extends StepEvent {
  readonly kind: "stream_closed";
  readonly streamId: StreamId;
}

export interface StreamFailedEvent extends StepEvent {
  readonly kind: "stream_failed";
  readonly streamId: StreamId;
  readonly error: WorkflowErrorRecord;
}

/** Event recorded when a replay-safe value is captured for deterministic reuse. */
export interface DeterministicValueRecordedEvent extends CountedStepEvent {
  readonly kind: "deterministic_value_recorded";
  readonly value: StorageValue;
}

export type MessageWaitSource = "hook" | "webhook";

interface TimestampedEvent {
  readonly timestamp: Temporal.Instant;
}

interface WorkflowStartedEvent extends TimestampedEvent {
  readonly kind: "workflow_started";
}

interface WorkflowCompletedEvent extends TimestampedEvent {
  readonly kind: "workflow_completed";
}

interface WorkflowFailedEvent extends TimestampedEvent {
  readonly kind: "workflow_failed";
}

interface StepEvent extends TimestampedEvent {
  readonly stepId: StepId;
  readonly stepName: string;
}

interface CountedStepEvent extends StepEvent {
  readonly count: number;
}

interface AttemptedStepEvent extends StepEvent {
  readonly attempt: number;
}

interface CountedAttemptedStepEvent extends CountedStepEvent, AttemptedStepEvent {}
