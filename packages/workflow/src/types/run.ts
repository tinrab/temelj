import { isTemporalStorageValue, type StorageValue } from "@temelj/storage";
import { z } from "zod";

import type { WorkflowErrorRecord } from "./error.ts";
import type { RunId } from "./run-id.ts";
import type { StepId } from "./step-id.ts";
import type { TelemetryContext } from "./telemetry.ts";
import type { WorkerId } from "./worker-id.ts";

import {
  temporalInstantSchema,
  nonBlankStringSchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
} from "./common.ts";
import { workflowErrorRecordSchema } from "./error.ts";
import { runIdSchema } from "./run-id.ts";
import { stepIdSchema } from "./step-id.ts";
import { workflowTelemetryContextSchema } from "./telemetry.ts";
import { workerIdSchema } from "./worker-id.ts";

export const WORKFLOW_ATTRIBUTE_MAX_KEY_LENGTH = 128;
export const WORKFLOW_ATTRIBUTE_MAX_COUNT = 64;
export const WORKFLOW_ATTRIBUTE_MAX_VALUE_BYTES = 1_024;
export const WORKFLOW_ATTRIBUTE_RESERVED_PREFIX = "$";

/** Validation issue describing why a value cannot be stored in workflow history. */
export interface WorkflowValueIssue {
  readonly path: string;
  readonly message: string;
}

export const workflowPersistedValueSchema: z.ZodType<StorageValue> = z.custom<StorageValue>(
  (value) => persistedValueIssue(value, "value", new WeakSet<object>(), false) === undefined,
);

/** Returns the first persistence validation issue for a workflow value, if one exists. */
export function persistedValueIssue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  allowUndefined: boolean,
): WorkflowValueIssue | undefined {
  if (value === undefined) {
    return allowUndefined ? undefined : unsupportedUndefinedIssue(path);
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : { path, message: "number must be finite" };
  }
  if (typeof value === "bigint") {
    return undefined;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return { path, message: `${typeof value} values are not supported` };
  }
  if (typeof value !== "object") {
    return { path, message: `${typeof value} values are not supported` };
  }
  if (seen.has(value)) {
    return { path, message: "circular references are not supported" };
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? undefined : { path, message: "Date must be valid" };
  }
  if (isTemporalStorageValue(value) || value instanceof RegExp || value instanceof Uint8Array) {
    return undefined;
  }

  seen.add(value);
  try {
    if (value instanceof Map) {
      return persistedMapIssue(value, path, seen);
    }
    if (value instanceof Set) {
      return persistedSetIssue(value, path, seen);
    }
    if (Array.isArray(value)) {
      return persistedArrayIssue(value, path, seen);
    }
    if (isPlainPersistedRecord(value)) {
      return persistedRecordIssue(value, path, seen);
    }
    return { path, message: "object type is not supported" };
  } finally {
    seen.delete(value);
  }
}

function persistedArrayIssue(
  value: readonly unknown[],
  path: string,
  seen: WeakSet<object>,
): WorkflowValueIssue | undefined {
  for (const [index, item] of value.entries()) {
    const issue = persistedValueIssue(item, `${path}[${index}]`, seen, false);
    if (issue !== undefined) {
      return issue;
    }
  }
  return undefined;
}

function persistedRecordIssue(
  value: Readonly<Record<string, unknown>>,
  path: string,
  seen: WeakSet<object>,
): WorkflowValueIssue | undefined {
  for (const [key, item] of Object.entries(value)) {
    const issue = persistedValueIssue(item, `${path}.${key}`, seen, false);
    if (issue !== undefined) {
      return issue;
    }
  }
  return undefined;
}

function persistedMapIssue(
  value: ReadonlyMap<unknown, unknown>,
  path: string,
  seen: WeakSet<object>,
): WorkflowValueIssue | undefined {
  let index = 0;
  for (const [key, item] of value) {
    const keyIssue = persistedValueIssue(key, `${path}.<key:${index}>`, seen, false);
    if (keyIssue !== undefined) {
      return keyIssue;
    }
    const itemIssue = persistedValueIssue(item, `${path}.<value:${index}>`, seen, false);
    if (itemIssue !== undefined) {
      return itemIssue;
    }
    index++;
  }
  return undefined;
}

function persistedSetIssue(
  value: ReadonlySet<unknown>,
  path: string,
  seen: WeakSet<object>,
): WorkflowValueIssue | undefined {
  let index = 0;
  for (const item of value) {
    const issue = persistedValueIssue(item, `${path}.<value:${index}>`, seen, false);
    if (issue !== undefined) {
      return issue;
    }
    index++;
  }
  return undefined;
}

function unsupportedUndefinedIssue(path: string): WorkflowValueIssue {
  return { path, message: "undefined is not supported here" };
}

function isPlainPersistedRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    return true;
  }
  return isObjectPrototypeNamedObject(prototype);
}

function isObjectPrototypeNamedObject(prototype: object): boolean {
  if (!("constructor" in prototype)) {
    return false;
  }
  const constructor = prototype.constructor;
  return (
    typeof constructor === "function" && "name" in constructor && constructor.name === "Object"
  );
}

export const workflowAttributeKeySchema = z
  .string()
  .min(1, "Workflow run attribute keys must not be empty")
  .max(
    WORKFLOW_ATTRIBUTE_MAX_KEY_LENGTH,
    `Workflow run attribute key must not exceed ${WORKFLOW_ATTRIBUTE_MAX_KEY_LENGTH} characters`,
  )
  .refine((key) => key.trim() !== "", {
    error: "Workflow run attribute keys must not be empty",
  })
  .refine((key) => !key.startsWith(WORKFLOW_ATTRIBUTE_RESERVED_PREFIX), {
    error: `Workflow run attribute key uses reserved prefix ${WORKFLOW_ATTRIBUTE_RESERVED_PREFIX}`,
  });

export const workflowAttributePrimitiveValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const workflowAttributeValueSchema = workflowAttributePrimitiveValueSchema.refine(
  (value) => encodedWorkflowAttributeByteLength(value) <= WORKFLOW_ATTRIBUTE_MAX_VALUE_BYTES,
  {
    error: `Workflow run attribute value must not exceed ${WORKFLOW_ATTRIBUTE_MAX_VALUE_BYTES} encoded bytes`,
  },
);

export const workflowRunAttributesSchema = z
  .record(workflowAttributeKeySchema, workflowAttributeValueSchema)
  .refine((attributes) => Object.keys(attributes).length <= WORKFLOW_ATTRIBUTE_MAX_COUNT, {
    error: `Workflow run attributes must not include more than ${WORKFLOW_ATTRIBUTE_MAX_COUNT} keys`,
  });

export const workflowAttributePatchSchema = z
  .record(workflowAttributeKeySchema, workflowAttributeValueSchema.optional())
  .refine((attributes) => Object.keys(attributes).length <= WORKFLOW_ATTRIBUTE_MAX_COUNT, {
    error: `Workflow run attributes must not include more than ${WORKFLOW_ATTRIBUTE_MAX_COUNT} keys`,
  });

function encodedWorkflowAttributeByteLength(
  value: z.infer<typeof workflowAttributePrimitiveValueSchema>,
): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const workflowRunStatusSchema = z.enum([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "canceled",
]);

export const workflowTerminalRunStatusSchema = z.enum(["completed", "failed", "canceled"]);

export const workflowRunRetryReasonSchema = z.enum(["workflow", "step", "missing_implementation"]);

export const workflowRunTransitionReasonSchema = z.enum([
  "created",
  "claimed",
  "reclaimed",
  "started",
  "waiting",
  "rescheduled",
  "lease_released",
  "manual_retry",
  "permanent_failure",
  "retry",
  "missing_implementation",
  "completed",
  "failed",
  "deadline",
  "canceled",
]);

/** Type used for workflow step type values. */
export const workflowStepTypeSchema = z.enum([
  "run",
  "sleep",
  "workflow",
  "message-send",
  "message-wait",
  "stream",
  "deterministic",
  "metadata",
  "attributes",
]);

export const workflowMaterializedStepTypeSchema = z.enum([
  "run",
  "sleep",
  "workflow",
  "message-send",
  "message-wait",
  "stream",
  "deterministic",
]);

export const workflowRunRecordSchema = z.object({
  id: runIdSchema,
  namespace: nonBlankStringSchema,
  workflowName: nonBlankStringSchema,
  workflowVersion: nonBlankStringSchema.optional(),
  status: workflowRunStatusSchema,
  input: workflowPersistedValueSchema.optional(),
  context: workflowPersistedValueSchema.optional(),
  telemetryContext: workflowTelemetryContextSchema.optional(),
  metadata: workflowPersistedValueSchema.optional(),
  attributes: workflowRunAttributesSchema.optional(),
  output: workflowPersistedValueSchema.optional(),
  error: workflowErrorRecordSchema.optional(),
  attempts: nonNegativeSafeIntegerSchema.optional(),
  idempotencyKey: nonBlankStringSchema.optional(),
  parentRunId: runIdSchema.optional(),
  parentStepId: stepIdSchema.optional(),
  parentStepName: nonBlankStringSchema.optional(),
  parentStepAttempt: positiveSafeIntegerSchema.optional(),
  workerId: workerIdSchema.optional(),
  createdAt: temporalInstantSchema,
  updatedAt: temporalInstantSchema,
  lastTransitionAt: temporalInstantSchema,
  lastTransitionReason: workflowRunTransitionReasonSchema,
  availableAt: temporalInstantSchema.optional(),
  retryAt: temporalInstantSchema.optional(),
  retryReason: workflowRunRetryReasonSchema.optional(),
  retryAttempt: positiveSafeIntegerSchema.optional(),
  retryStepId: stepIdSchema.optional(),
  retryStepName: nonBlankStringSchema.optional(),
  deadlineAt: temporalInstantSchema.optional(),
  leaseExpiresAt: temporalInstantSchema.optional(),
  startedAt: temporalInstantSchema.optional(),
  finishedAt: temporalInstantSchema.optional(),
});

export type { RunId } from "./run-id.ts";

/** Type used for workflow attribute value values. */
export type WorkflowAttributeValue = string | number | boolean | null;

/** Type used for workflow run attributes values. */
export type WorkflowRunAttributes = Readonly<Record<string, WorkflowAttributeValue>>;

/** Type used for workflow attribute patch values. */
export type WorkflowAttributePatch = Readonly<Record<string, WorkflowAttributeValue | undefined>>;

/** Status values for workflow run. */
export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "canceled";

/** Status values for workflow terminal run. */
export type WorkflowTerminalRunStatus = "completed" | "failed" | "canceled";

/** Type used for workflow step type values. */
export type WorkflowStepType =
  | "run"
  | "sleep"
  | "workflow"
  | "message-send"
  | "message-wait"
  | "stream"
  | "deterministic"
  | "metadata"
  | "attributes";

/** Stable identity assigned to a durable step occurrence within a workflow run. */
export interface WorkflowStepIdentity<TType extends WorkflowStepType = WorkflowStepType> {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly kind: TType;
}

/** Type used for workflow materialized step type values. */
export type WorkflowMaterializedStepType =
  | "run"
  | "sleep"
  | "workflow"
  | "message-send"
  | "message-wait"
  | "stream"
  | "deterministic";

/** Type used for workflow run retry reason values. */
export type WorkflowRunRetryReason = "workflow" | "step" | "missing_implementation";

/** Type used for workflow definition name values stored on runs. */
export type WorkflowRunWorkflowName = string;

/** Type used for workflow definition version values stored on runs. */
export type WorkflowRunWorkflowVersion = string;

/** Type used for workflow run transition reason values. */
export type WorkflowRunTransitionReason =
  | "created"
  | "claimed"
  | "reclaimed"
  | "started"
  | "waiting"
  | "rescheduled"
  | "lease_released"
  | "manual_retry"
  | "permanent_failure"
  | "retry"
  | "missing_implementation"
  | "completed"
  | "failed"
  | "deadline"
  | "canceled";

/** Stored record for workflow run. */
export interface WorkflowRunRecord<TInput = StorageValue, TOutput = StorageValue> {
  readonly id: RunId;
  readonly namespace: string;
  readonly workflowName: WorkflowRunWorkflowName;
  readonly workflowVersion?: WorkflowRunWorkflowVersion;
  readonly status: WorkflowRunStatus;
  readonly input?: TInput;
  readonly context?: StorageValue;
  readonly telemetryContext?: TelemetryContext;
  readonly metadata?: StorageValue;
  readonly attributes?: WorkflowRunAttributes;
  readonly output?: TOutput;
  readonly error?: WorkflowErrorRecord;
  readonly attempts?: number;
  readonly idempotencyKey?: string;
  readonly parentRunId?: RunId;
  readonly parentStepId?: StepId;
  readonly parentStepName?: string;
  readonly parentStepAttempt?: number;
  readonly workerId?: WorkerId;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly lastTransitionAt: Temporal.Instant;
  readonly lastTransitionReason: WorkflowRunTransitionReason;
  readonly availableAt?: Temporal.Instant;
  readonly retryAt?: Temporal.Instant;
  readonly retryReason?: WorkflowRunRetryReason;
  readonly retryAttempt?: number;
  readonly retryStepId?: StepId;
  readonly retryStepName?: string;
  readonly deadlineAt?: Temporal.Instant;
  readonly leaseExpiresAt?: Temporal.Instant;
  readonly startedAt?: Temporal.Instant;
  readonly finishedAt?: Temporal.Instant;
}

/** Describes the workflow lifecycle event contract. */
export interface WorkflowLifecycleEvent {
  readonly run: WorkflowRunRecord;
  readonly previousRun?: WorkflowRunRecord;
  readonly status: WorkflowRunStatus;
  readonly reason: WorkflowRunTransitionReason;
  readonly timestamp: Temporal.Instant;
  readonly workflowName: string;
  readonly workflowVersion?: string;
}

/** Type used for workflow lifecycle callback values. */
export type WorkflowLifecycleCallback = (event: WorkflowLifecycleEvent) => void | Promise<void>;
