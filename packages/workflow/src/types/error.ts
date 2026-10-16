import type { WorkflowErrorCode } from "../errors/codes.ts";
import type { StepId } from "./ids.ts";

/** Returns workflow-safe error details, or undefined when the input cannot be persisted. */
/** JSON-serializable detail fields attached to workflow errors. */
export type ErrorDetails = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Persisted representation of an error captured during workflow execution. */
export interface WorkflowErrorRecord {
  readonly code?: WorkflowErrorCode;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly details?: ErrorDetails;
}

export interface WorkflowErrorOptions extends ErrorOptions {
  readonly code?: WorkflowErrorCode;
  readonly details?: ErrorDetails;
}

export interface RetryableErrorOptions extends WorkflowErrorOptions {
  readonly retryAt?: Temporal.Instant;
  readonly retryDelay?: Temporal.Duration;
}

export interface StepExecutionErrorOptions {
  readonly stepId: StepId;
  readonly stepName: string;
  readonly attempt: number;
  readonly cause: unknown;
}

/** Identity fields carried by implementation-not-found errors. */
export type ImplementationErrorDetails = {
  workflowName: string;
  workflowVersion?: string;
};
