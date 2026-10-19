import { ss } from "@temelj/standard-schema";

import { attributeValueSchema } from "../attributes.ts";
import {
  discriminated,
  temporalInstantSchema,
  nonBlankStringListSchema,
  nonBlankStringSchema,
  temporalNonNegativeDurationSchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  idSchema,
  telemetryContextSchema,
} from "./common.ts";
import { errorRecordSchema } from "./error.ts";
import { persistedValueSchema } from "./persisted-value.ts";
import { childWorkflowCancellationPolicySchema } from "./run.ts";

const messageWaitSourceSchema = ss.picklist(["hook", "webhook"]);

const eventAttributesSchema = ss.record(attributeValueSchema);

const eventBaseFields = {
  timestamp: temporalInstantSchema,
};

const stepIdentityFields = {
  stepId: idSchema,
  stepName: nonBlankStringSchema,
};

const countFields = {
  count: positiveSafeIntegerSchema,
};

const attemptFields = {
  attempt: positiveSafeIntegerSchema,
};

const messageWaiterStepIdsSchema = ss.refine(
  nonBlankStringListSchema,
  (items) => new Set(items).size === items.length,
  "Expected unique step ids",
);

const startedEventSchema = ss.object({
  ...eventBaseFields,
  kind: ss.literal("workflow_started"),
});

const completedEventSchema = ss.object({
  ...eventBaseFields,
  kind: ss.literal("workflow_completed"),
});

const failedEventSchema = ss.object({
  ...eventBaseFields,
  kind: ss.literal("workflow_failed"),
});

const stepStartedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  ...attemptFields,
  kind: ss.literal("step_started"),
  timeoutAt: ss.optional(temporalInstantSchema),
});

const stepCompletedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...attemptFields,
  kind: ss.literal("step_completed"),
  result: ss.optional(persistedValueSchema),
});

const stepFailedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...attemptFields,
  kind: ss.literal("step_failed"),
  error: errorRecordSchema,
});

const sleepStartedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  kind: ss.literal("sleep_started"),
  until: temporalInstantSchema,
  duration: ss.optional(temporalNonNegativeDurationSchema),
});

const sleepCompletedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  kind: ss.literal("sleep_completed"),
});

const childWorkflowStartedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  ...attemptFields,
  kind: ss.literal("child_workflow_started"),
  childRunId: idSchema,
  workflowName: nonBlankStringSchema,
  workflowVersion: ss.optional(nonBlankStringSchema),
  cancellation: ss.optional(childWorkflowCancellationPolicySchema),
  input: ss.optional(persistedValueSchema),
  idempotencyKey: ss.optional(nonBlankStringSchema),
  timeoutAt: ss.optional(temporalInstantSchema),
});

const childWorkflowCompletedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...attemptFields,
  kind: ss.literal("child_workflow_completed"),
  childRunId: idSchema,
  result: ss.optional(persistedValueSchema),
});

const childWorkflowFailedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...attemptFields,
  kind: ss.literal("child_workflow_failed"),
  childRunId: idSchema,
  error: errorRecordSchema,
});

const messageSentEventSchema = ss.object({
  ...eventBaseFields,
  kind: ss.literal("message_sent"),
  messageId: idSchema,
  payload: ss.optional(persistedValueSchema),
  waiterStepIds: ss.optional(messageWaiterStepIdsSchema),
  idempotencyKey: ss.optional(nonBlankStringSchema),
  telemetryContext: ss.optional(telemetryContextSchema),
});

const messageSendStartedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  kind: ss.literal("message_send_started"),
  targetRunId: idSchema,
  messageId: idSchema,
  payload: ss.optional(persistedValueSchema),
  idempotencyKey: ss.optional(nonBlankStringSchema),
});

const messageSendCompletedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  kind: ss.literal("message_send_completed"),
  targetRunId: idSchema,
  messageId: idSchema,
});

const messageSendFailedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  kind: ss.literal("message_send_failed"),
  targetRunId: idSchema,
  messageId: idSchema,
  error: errorRecordSchema,
});

const messageWaitStartedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  kind: ss.literal("message_wait_started"),
  messageId: idSchema,
  source: ss.optional(messageWaitSourceSchema),
  timeoutAt: ss.optional(temporalInstantSchema),
});

const messageWaitCompletedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  kind: ss.literal("message_wait_completed"),
  messageId: idSchema,
  payload: ss.optional(persistedValueSchema),
  messageTimestamp: temporalInstantSchema,
  telemetryContext: ss.optional(telemetryContextSchema),
});

const messageWaitFailedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  kind: ss.literal("message_wait_failed"),
  messageId: idSchema,
  error: errorRecordSchema,
});

const metadataSetEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  kind: ss.literal("metadata_set"),
  metadata: persistedValueSchema,
});

const attributesSetEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  kind: ss.literal("attributes_set"),
  attributes: ss.optional(eventAttributesSchema),
  removeAttributes: ss.optional(ss.array(nonBlankStringSchema)),
});

const streamStartedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  kind: ss.literal("stream_started"),
  streamId: idSchema,
  contentType: ss.optional(nonBlankStringSchema),
  metadata: ss.optional(persistedValueSchema),
});

const streamChunkEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  kind: ss.literal("stream_chunk"),
  streamId: idSchema,
  index: nonNegativeSafeIntegerSchema,
  chunk: ss.optional(persistedValueSchema),
});

const streamClosedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  kind: ss.literal("stream_closed"),
  streamId: idSchema,
});

const streamFailedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  kind: ss.literal("stream_failed"),
  streamId: idSchema,
  error: errorRecordSchema,
});

const deterministicValueRecordedEventSchema = ss.object({
  ...eventBaseFields,
  ...stepIdentityFields,
  ...countFields,
  kind: ss.literal("deterministic_value_recorded"),
  value: persistedValueSchema,
});

export const eventRecordSchema = discriminated(
  "kind",
  {
    workflow_started: startedEventSchema,
    workflow_completed: completedEventSchema,
    workflow_failed: failedEventSchema,
    step_started: stepStartedEventSchema,
    step_completed: stepCompletedEventSchema,
    step_failed: stepFailedEventSchema,
    sleep_started: sleepStartedEventSchema,
    sleep_completed: sleepCompletedEventSchema,
    child_workflow_started: childWorkflowStartedEventSchema,
    child_workflow_completed: childWorkflowCompletedEventSchema,
    child_workflow_failed: childWorkflowFailedEventSchema,
    message_sent: messageSentEventSchema,
    message_send_started: messageSendStartedEventSchema,
    message_send_completed: messageSendCompletedEventSchema,
    message_send_failed: messageSendFailedEventSchema,
    message_wait_started: messageWaitStartedEventSchema,
    message_wait_completed: messageWaitCompletedEventSchema,
    message_wait_failed: messageWaitFailedEventSchema,
    metadata_set: metadataSetEventSchema,
    attributes_set: attributesSetEventSchema,
    stream_started: streamStartedEventSchema,
    stream_chunk: streamChunkEventSchema,
    stream_closed: streamClosedEventSchema,
    stream_failed: streamFailedEventSchema,
    deterministic_value_recorded: deterministicValueRecordedEventSchema,
  },
  "Unsupported workflow event kind",
);

export const eventRecordListSchema = ss.array(eventRecordSchema);
