import { z } from "zod";

import type { WorkflowErrorCode } from "./error-code.ts";
import type { MessageId } from "./message-id.ts";
import type { RunId, WorkflowRunStatus, WorkflowTerminalRunStatus } from "./run.ts";
import type { StepId } from "./step-id.ts";

import { nonBlankStringSchema } from "./common.ts";
import { workflowErrorCodeSchema } from "./error-code.ts";

export { WorkflowErrorCode, workflowErrorCodeSchema } from "./error-code.ts";

const workflowRunStatuses = [
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "canceled",
] as const;
const workflowTerminalRunStatuses = ["completed", "failed", "canceled"] as const;

export const workflowErrorDetailSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const workflowErrorDetailsSchema = z
  .record(nonBlankStringSchema, workflowErrorDetailSchema)
  .refine(
    (value) => {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    },
    { error: "Expected a plain error details object" },
  );

export const workflowErrorRecordSchema = z.looseObject({
  code: workflowErrorCodeSchema.optional(),
  name: nonBlankStringSchema,
  message: nonBlankStringSchema,
  stack: nonBlankStringSchema.optional(),
  details: workflowErrorDetailsSchema.optional(),
});

export const optionalWorkflowErrorStringSchema = nonBlankStringSchema.optional();
export const workflowErrorRunStatusSchema: z.ZodType<WorkflowRunStatus> = z.enum(
  workflowRunStatuses,
  { error: "Expected a workflow run status" },
);
export const workflowTerminalErrorRunStatusSchema: z.ZodType<WorkflowTerminalRunStatus> = z.enum(
  workflowTerminalRunStatuses,
  { error: "Expected a terminal workflow run status" },
);

/** Returns workflow-safe error details, or undefined when the input cannot be persisted. */
export function sanitizedWorkflowErrorDetails(details: unknown): WorkflowErrorDetails | undefined {
  const parsed = workflowErrorDetailsSchema.safeParse(details);
  if (!parsed.success) {
    return undefined;
  }
  const sanitized = Object.fromEntries(
    Object.entries(parsed.data).filter(([key, value]) => {
      return (
        nonBlankStringSchema.safeParse(key).success &&
        workflowErrorDetailSchema.safeParse(value).success
      );
    }),
  );
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

/** JSON-serializable detail fields attached to workflow errors. */
export type WorkflowErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

/** Persisted representation of an error captured during workflow execution. */
export interface WorkflowErrorRecord {
  readonly [key: string]: unknown;
  readonly code?: WorkflowErrorCode;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly details?: WorkflowErrorDetails;
}

/** Options for workflow error. */
export interface WorkflowErrorOptions extends ErrorOptions {
  readonly code?: WorkflowErrorCode;
  readonly details?: WorkflowErrorDetails;
}

/** Options for marking a workflow failure as non-retryable. */
export type WorkflowNonRetryableErrorOptions = WorkflowErrorOptions;

/** Options for workflow retryable error. */
export interface WorkflowRetryableErrorOptions extends WorkflowErrorOptions {
  readonly retryAt?: Temporal.Instant;
  readonly retryDelay?: Temporal.Duration;
}

/** Options for workflow step execution error. */
export interface WorkflowStepExecutionErrorOptions {
  readonly stepId: StepId;
  readonly stepName: string;
  readonly attempt: number;
  readonly cause: unknown;
}

/** Options for errors raised when a run belongs to a different workflow than expected. */
export interface WorkflowRunMismatchErrorOptions {
  readonly runId: RunId;
  readonly expectedWorkflowName: string;
  readonly actualWorkflowName: string;
}

/** Options for errors raised when a child workflow does not finish before its timeout. */
export interface WorkflowChildWorkflowTimeoutErrorOptions {
  readonly runId: RunId;
  readonly childrunId: RunId;
  readonly stepId: StepId;
  readonly timeoutAt: Temporal.Instant;
}

/** Options for errors raised when a workflow message wait times out. */
export interface WorkflowMessageWaitTimeoutErrorOptions {
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly messageId: MessageId;
  readonly timeoutAt: Temporal.Instant;
}

/** Options for errors raised when a pending external resume hook is disposed. */
export interface WorkflowHookDisposedErrorOptions {
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly messageId: MessageId;
}

/** Options for errors raised when a messageId cannot be delivered to a terminal run. */
export interface WorkflowMessageDeliveryErrorOptions {
  readonly runId: RunId;
  readonly status: WorkflowTerminalRunStatus;
  readonly messageId: MessageId;
}

/** Options for errors raised when a messageId idempotency key conflicts with another messageId. */
export interface WorkflowMessageIdempotencyConflictErrorOptions {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly idempotencyKey: string;
}

/** Options for marking a workflow run as permanently failed with an operator reason. */
export interface WorkflowPermanentFailureErrorOptions {
  readonly runId: RunId;
  readonly reason: string;
}

/** Options for errors raised when a durable step attempt exceeds its timeout. */
export interface WorkflowStepTimeoutErrorOptions {
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly attempt: number;
  readonly timeoutAt: Temporal.Instant;
}

/** Options for errors raised when replayed history no longer matches the workflow code. */
export interface WorkflowReplayDivergenceErrorOptions {
  readonly expectedStepId?: string;
  readonly actualStepId?: string;
  readonly message: string;
}
