import type { StorageValue } from "@temelj/storage";

import { z } from "zod";

import type { WorkflowErrorRecord } from "./error.ts";
import type { MessageId } from "./message-id.ts";
import type { RunId, WorkflowAttributeValue, WorkflowStepType } from "./run.ts";
import type { StepId } from "./step-id.ts";
import type { WorkflowChildWorkflowCancellationPolicy } from "./step.ts";
import type { StreamId } from "./stream-id.ts";
import type { TelemetryContext } from "./telemetry.ts";

import {
  temporalInstantSchema,
  nonBlankStringListSchema,
  nonBlankStringSchema,
  temporalNonNegativeDurationSchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
} from "./common.ts";
import { workflowErrorRecordSchema } from "./error.ts";
import { messageIdSchema } from "./message-id.ts";
import { runIdSchema } from "./run-id.ts";
import { workflowAttributeValueSchema, workflowPersistedValueSchema } from "./run.ts";
import { stepIdSchema } from "./step-id.ts";
import { workflowChildWorkflowCancellationPolicySchema } from "./step.ts";
import { streamIdSchema } from "./stream-id.ts";
import { workflowTelemetryContextSchema } from "./telemetry.ts";

export const workflowMessageWaitSourceSchema = z.enum(["hook", "webhook"]);

export const workflowRunEventKindSchema = z.enum([
  "workflow_started",
  "workflow_completed",
  "workflow_failed",
]);
export const workflowStepEventKindSchema = z.enum([
  "step_started",
  "step_completed",
  "step_failed",
]);
export const workflowSleepEventKindSchema = z.enum(["sleep_started", "sleep_completed"]);
export const workflowChildWorkflowEventKindSchema = z.enum([
  "child_workflow_started",
  "child_workflow_completed",
  "child_workflow_failed",
]);
export const workflowMessageEventKindSchema = z.enum([
  "message_sent",
  "message_send_started",
  "message_send_completed",
  "message_send_failed",
  "message_wait_started",
  "message_wait_completed",
  "message_wait_failed",
]);
export const workflowStreamEventKindSchema = z.enum([
  "stream_started",
  "stream_chunk",
  "stream_closed",
  "stream_failed",
]);
export const workflowDataEventKindSchema = z.enum(["metadata_set", "attributes_set"]);
export const workflowDeterministicEventKindSchema = z.literal("deterministic_value_recorded");
export const workflowEventKindSchema = z.union([
  workflowRunEventKindSchema,
  workflowStepEventKindSchema,
  workflowSleepEventKindSchema,
  workflowChildWorkflowEventKindSchema,
  workflowMessageEventKindSchema,
  workflowStreamEventKindSchema,
  workflowDataEventKindSchema,
  workflowDeterministicEventKindSchema,
]);

const persistedValueSchema = workflowPersistedValueSchema;
const runAttributesSchema = z.record(z.string(), workflowAttributeValueSchema);

const eventBaseShape = {
  timestamp: temporalInstantSchema,
};

const stepIdentityShape = {
  stepId: stepIdSchema,
  stepName: nonBlankStringSchema,
};

const countShape = {
  count: positiveSafeIntegerSchema,
};

const attemptShape = {
  attempt: positiveSafeIntegerSchema,
};

export const workflowMessageWaiterStepIdsSchema = nonBlankStringListSchema.refine(
  (items) => new Set(items).size === items.length,
  {
    error: "Expected unique step ids",
  },
);

export const workflowStartedEventSchema = z.object({
  ...eventBaseShape,
  kind: z.literal("workflow_started"),
});
export const workflowCompletedEventSchema = z.object({
  ...eventBaseShape,
  kind: z.literal("workflow_completed"),
});
export const workflowFailedEventSchema = z.object({
  ...eventBaseShape,
  kind: z.literal("workflow_failed"),
});
export const workflowStepStartedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  ...attemptShape,
  kind: z.literal("step_started"),
  timeoutAt: temporalInstantSchema.optional(),
});
export const workflowStepCompletedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...attemptShape,
  kind: z.literal("step_completed"),
  result: persistedValueSchema.optional(),
});
export const workflowStepFailedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...attemptShape,
  kind: z.literal("step_failed"),
  error: workflowErrorRecordSchema,
});
export const workflowSleepStartedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  kind: z.literal("sleep_started"),
  until: temporalInstantSchema,
  duration: temporalNonNegativeDurationSchema.optional(),
});
export const workflowSleepCompletedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  kind: z.literal("sleep_completed"),
});
export const workflowChildWorkflowStartedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  ...attemptShape,
  kind: z.literal("child_workflow_started"),
  childRunId: runIdSchema,
  workflowName: nonBlankStringSchema,
  workflowVersion: nonBlankStringSchema.optional(),
  cancellation: workflowChildWorkflowCancellationPolicySchema.optional(),
  input: persistedValueSchema.optional(),
  idempotencyKey: nonBlankStringSchema.optional(),
  timeoutAt: temporalInstantSchema.optional(),
});
export const workflowChildWorkflowCompletedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...attemptShape,
  kind: z.literal("child_workflow_completed"),
  childRunId: runIdSchema,
  result: persistedValueSchema.optional(),
});
export const workflowChildWorkflowFailedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...attemptShape,
  kind: z.literal("child_workflow_failed"),
  childRunId: runIdSchema,
  error: workflowErrorRecordSchema,
});
export const workflowMessageSentEventSchema = z.object({
  ...eventBaseShape,
  kind: z.literal("message_sent"),
  messageId: messageIdSchema,
  payload: persistedValueSchema.optional(),
  waiterStepIds: workflowMessageWaiterStepIdsSchema.optional(),
  idempotencyKey: nonBlankStringSchema.optional(),
  telemetryContext: workflowTelemetryContextSchema.optional(),
});
export const workflowMessageSendStartedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  kind: z.literal("message_send_started"),
  targetRunId: runIdSchema,
  messageId: messageIdSchema,
  payload: persistedValueSchema.optional(),
  idempotencyKey: nonBlankStringSchema.optional(),
});
export const workflowMessageSendCompletedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  kind: z.literal("message_send_completed"),
  targetRunId: runIdSchema,
  messageId: messageIdSchema,
});
export const workflowMessageSendFailedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  kind: z.literal("message_send_failed"),
  targetRunId: runIdSchema,
  messageId: messageIdSchema,
  error: workflowErrorRecordSchema,
});
export const workflowMessageWaitStartedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  kind: z.literal("message_wait_started"),
  messageId: messageIdSchema,
  source: workflowMessageWaitSourceSchema.optional(),
  timeoutAt: temporalInstantSchema.optional(),
});
export const workflowMessageWaitCompletedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  kind: z.literal("message_wait_completed"),
  messageId: messageIdSchema,
  payload: persistedValueSchema.optional(),
  messageTimestamp: temporalInstantSchema,
  telemetryContext: workflowTelemetryContextSchema.optional(),
});
export const workflowMessageWaitFailedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  kind: z.literal("message_wait_failed"),
  messageId: messageIdSchema,
  error: workflowErrorRecordSchema,
});
export const workflowMetadataSetEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  kind: z.literal("metadata_set"),
  metadata: persistedValueSchema,
});
export const workflowAttributesSetEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  kind: z.literal("attributes_set"),
  attributes: runAttributesSchema.optional(),
  removeAttributes: z.array(nonBlankStringSchema).readonly().optional(),
});
export const workflowStreamStartedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  kind: z.literal("stream_started"),
  streamId: streamIdSchema,
  contentType: nonBlankStringSchema.optional(),
  metadata: persistedValueSchema.optional(),
});
export const workflowStreamChunkEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  kind: z.literal("stream_chunk"),
  streamId: streamIdSchema,
  index: nonNegativeSafeIntegerSchema,
  chunk: persistedValueSchema.optional(),
});
export const workflowStreamClosedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  kind: z.literal("stream_closed"),
  streamId: streamIdSchema,
});
export const workflowStreamFailedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  kind: z.literal("stream_failed"),
  streamId: streamIdSchema,
  error: workflowErrorRecordSchema,
});
export const workflowDeterministicValueRecordedEventSchema = z.object({
  ...eventBaseShape,
  ...stepIdentityShape,
  ...countShape,
  kind: z.literal("deterministic_value_recorded"),
  value: persistedValueSchema,
});

export const workflowEventRecordSchema = z.discriminatedUnion("kind", [
  workflowStartedEventSchema,
  workflowCompletedEventSchema,
  workflowFailedEventSchema,
  workflowStepStartedEventSchema,
  workflowStepCompletedEventSchema,
  workflowStepFailedEventSchema,
  workflowSleepStartedEventSchema,
  workflowSleepCompletedEventSchema,
  workflowChildWorkflowStartedEventSchema,
  workflowChildWorkflowCompletedEventSchema,
  workflowChildWorkflowFailedEventSchema,
  workflowMessageSentEventSchema,
  workflowMessageSendStartedEventSchema,
  workflowMessageSendCompletedEventSchema,
  workflowMessageSendFailedEventSchema,
  workflowMessageWaitStartedEventSchema,
  workflowMessageWaitCompletedEventSchema,
  workflowMessageWaitFailedEventSchema,
  workflowMetadataSetEventSchema,
  workflowAttributesSetEventSchema,
  workflowStreamStartedEventSchema,
  workflowStreamChunkEventSchema,
  workflowStreamClosedEventSchema,
  workflowStreamFailedEventSchema,
  workflowDeterministicValueRecordedEventSchema,
]);

export const workflowEventRecordListSchema = z.array(workflowEventRecordSchema);

/** Type used for workflow message sent event payloads. */
export type MessageSentPayload = StorageValue;

/** Type used for workflow stream failure event errors. */
export type StreamFailedError = WorkflowErrorRecord;

/** Discriminant values for every durable workflow event record. */
export type EventKind =
  | WorkflowRunEventKind
  | WorkflowStepEventKind
  | SleepEventKind
  | ChildWorkflowEventKind
  | MessageEventKind
  | StreamEventKind
  | DataEventKind
  | DeterministicEventKind;

/** Metadata describing how an event participates in cleanup and step-attempt materialization. */
export interface EventDescriptor {
  readonly kind: EventKind;
  readonly category: EventDescriptorCategory;
  readonly cleanup: boolean;
  readonly stepType?: WorkflowStepType;
  readonly stepAttempt?: EventDescriptorStepAttempt;
  readonly terminalStepAttempt?: boolean;
  readonly startedEventType?: EventKind;
  readonly startedEventMatchFields?: readonly string[];
  readonly identityFields?: readonly string[];
  readonly valueIdentityFields?: readonly string[];
  readonly stringListIdentityFields?: readonly string[];
}

/** Event descriptor category values. */
export type EventDescriptorCategory =
  | "workflow"
  | "step"
  | "sleep"
  | "child_workflow"
  | "message"
  | "stream"
  | "deterministic"
  | "metadata";

/** How an event maps to a materialized step attempt. */
export type EventDescriptorStepAttempt = "event" | "single";

/** Event kinds emitted for workflow lifecycle transitions. */
export type WorkflowRunEventKind = "workflow_started" | "workflow_completed" | "workflow_failed";

/** Event kinds emitted for durable task attempts. */
export type WorkflowStepEventKind = "step_started" | "step_completed" | "step_failed";

/** Event kinds emitted for durable sleeps. */
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

/** Event kinds emitted for durable workflow streams. */
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
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepFailedEvent
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

/** Workflow event record narrowed by a workflow event kind. */
export type WorkflowEvent = Extract<EventRecord, { readonly kind: EventKind }>;

/** Workflow lifecycle event record. */
export type WorkflowRunEvent = Extract<EventRecord, { readonly kind: WorkflowRunEventKind }>;

/** Event recorded when a durable task attempt starts. */
export interface WorkflowStepStartedEvent extends WorkflowCountedAttemptedStepEvent {
  readonly kind: "step_started";
  readonly timeoutAt?: Temporal.Instant;
}

/** Event recorded when a durable task attempt completes. */
export interface WorkflowStepCompletedEvent extends WorkflowAttemptedStepEvent {
  readonly kind: "step_completed";
  readonly result?: StorageValue;
}

/** Event recorded when a durable task attempt fails. */
export interface WorkflowStepFailedEvent extends WorkflowAttemptedStepEvent {
  readonly kind: "step_failed";
  readonly error: WorkflowErrorRecord;
}

/** Event recorded when a durable sleep starts. */
export interface SleepStartedEvent extends WorkflowCountedStepEvent {
  readonly kind: "sleep_started";
  readonly until: Temporal.Instant;
  readonly duration?: Temporal.Duration;
}

/** Event recorded when a durable sleep completes. */
export interface SleepCompletedEvent extends WorkflowStepEvent {
  readonly kind: "sleep_completed";
}

/** Event recorded when a child workflow is started. */
export interface ChildWorkflowStartedEvent extends WorkflowCountedAttemptedStepEvent {
  readonly kind: "child_workflow_started";
  readonly childRunId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly cancellation?: WorkflowChildWorkflowCancellationPolicy;
  readonly input?: StorageValue;
  readonly idempotencyKey?: string;
  readonly timeoutAt?: Temporal.Instant;
}

/** Event recorded when a child workflow completes. */
export interface ChildWorkflowCompletedEvent extends WorkflowAttemptedStepEvent {
  readonly kind: "child_workflow_completed";
  readonly childRunId: RunId;
  readonly result?: StorageValue;
}

/** Event recorded when a child workflow fails. */
export interface ChildWorkflowFailedEvent extends WorkflowAttemptedStepEvent {
  readonly kind: "child_workflow_failed";
  readonly childRunId: RunId;
  readonly error: WorkflowErrorRecord;
}

/** Event recorded when an external messageId is accepted for a run. */
export interface MessageSentEvent extends WorkflowTimestampedEvent {
  readonly kind: "message_sent";
  readonly messageId: MessageId;
  readonly payload?: MessageSentPayload;
  readonly waiterStepIds?: readonly StepId[];
  readonly idempotencyKey?: string;
  readonly telemetryContext?: TelemetryContext;
}

/** Event recorded when a workflow starts sending a messageId to another run. */
export interface MessageSendStartedEvent extends WorkflowCountedStepEvent {
  readonly kind: "message_send_started";
  readonly targetRunId: RunId;
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly idempotencyKey?: string;
}

/** Event recorded when a workflow message send completes. */
export interface MessageSendCompletedEvent extends WorkflowStepEvent {
  readonly kind: "message_send_completed";
  readonly targetRunId: RunId;
  readonly messageId: MessageId;
}

/** Event recorded when a workflow message send fails. */
export interface MessageSendFailedEvent extends WorkflowStepEvent {
  readonly kind: "message_send_failed";
  readonly targetRunId: RunId;
  readonly messageId: MessageId;
  readonly error: WorkflowErrorRecord;
}

/** Event recorded when a workflow starts waiting for a messageId. */
export interface MessageWaitStartedEvent extends WorkflowCountedStepEvent {
  readonly kind: "message_wait_started";
  readonly messageId: MessageId;
  readonly source?: MessageWaitSource;
  readonly timeoutAt?: Temporal.Instant;
}

/** Event recorded when a waiting workflow receives a messageId. */
export interface MessageWaitCompletedEvent extends WorkflowStepEvent {
  readonly kind: "message_wait_completed";
  readonly messageId: MessageId;
  readonly payload?: StorageValue;
  readonly messageTimestamp: Temporal.Instant;
  readonly telemetryContext?: TelemetryContext;
}

/** Event recorded when a message wait fails or times out. */
export interface MessageWaitFailedEvent extends WorkflowStepEvent {
  readonly kind: "message_wait_failed";
  readonly messageId: MessageId;
  readonly error: WorkflowErrorRecord;
}

/** Event recorded when workflow run metadata is replaced. */
export interface MetadataSetEvent extends WorkflowCountedStepEvent {
  readonly kind: "metadata_set";
  readonly metadata: StorageValue;
}

/** Event recorded when workflow run attributes are patched. */
export interface AttributesSetEvent extends WorkflowCountedStepEvent {
  readonly kind: "attributes_set";
  readonly attributes?: Readonly<Record<string, WorkflowAttributeValue>>;
  readonly removeAttributes?: readonly string[];
}

/** Event recorded when a durable stream is opened. */
export interface StreamStartedEvent extends WorkflowCountedStepEvent {
  readonly kind: "stream_started";
  readonly streamId: StreamId;
  readonly contentType?: string;
  readonly metadata?: StorageValue;
}

/** Event recorded for a durable stream chunk. */
export interface StreamChunkEvent extends WorkflowStepEvent {
  readonly kind: "stream_chunk";
  readonly streamId: StreamId;
  readonly index: number;
  readonly chunk?: StorageValue;
}

/** Event recorded when a durable stream closes normally. */
export interface StreamClosedEvent extends WorkflowStepEvent {
  readonly kind: "stream_closed";
  readonly streamId: StreamId;
}

/** Event recorded when a durable stream fails. */
export interface StreamFailedEvent extends WorkflowStepEvent {
  readonly kind: "stream_failed";
  readonly streamId: StreamId;
  readonly error: StreamFailedError;
}

/** Event recorded when a replay-safe value is captured for deterministic reuse. */
export interface DeterministicValueRecordedEvent extends WorkflowCountedStepEvent {
  readonly kind: "deterministic_value_recorded";
  readonly value: StorageValue;
}

/** Source that resumed a workflow message wait. */
export type MessageWaitSource = "hook" | "webhook";

interface WorkflowTimestampedEvent {
  readonly timestamp: Temporal.Instant;
}

interface WorkflowStartedEvent extends WorkflowTimestampedEvent {
  readonly kind: "workflow_started";
}

interface WorkflowCompletedEvent extends WorkflowTimestampedEvent {
  readonly kind: "workflow_completed";
}

interface WorkflowFailedEvent extends WorkflowTimestampedEvent {
  readonly kind: "workflow_failed";
}

interface WorkflowStepEvent extends WorkflowTimestampedEvent {
  readonly stepId: StepId;
  readonly stepName: string;
}

interface WorkflowCountedStepEvent extends WorkflowStepEvent {
  readonly count: number;
}

interface WorkflowAttemptedStepEvent extends WorkflowStepEvent {
  readonly attempt: number;
}

interface WorkflowCountedAttemptedStepEvent
  extends WorkflowCountedStepEvent, WorkflowAttemptedStepEvent {}
