import type { WorkflowDefinition } from "./definition.ts";
import type { RunId } from "./run.ts";
import type { StepId } from "./step-id.ts";

/** Callback used to resolve the workflow version stored on a new run. */
export type WorkflowVersionResolver = (
  workflowName: string,
  definition: WorkflowDefinition<unknown, unknown, unknown>,
) => string | undefined | Promise<string | undefined>;

/** Options that control workflow run creation and scheduling. */
export interface WorkflowStartOptions {
  readonly id?: string;
  readonly idempotencyKey?: string;
  readonly workflowVersion?: string;
  readonly workflowVersionResolver?: WorkflowVersionResolver;
  readonly context?: unknown;
  readonly parent?: WorkflowRunParentOptions;
  readonly availableAt?: Temporal.Instant;
  readonly deadlineAt?: Temporal.Instant;
}

/** Options for creating a single delayed workflow run at the next interval boundary. */
export interface ScheduleNextOptions {
  readonly id?: string;
  readonly every: Temporal.Duration;
  readonly idempotencyKey: string;
  readonly workflowVersion?: string;
  readonly workflowVersionResolver?: WorkflowVersionResolver;
  readonly context?: unknown;
  readonly parent?: WorkflowRunParentOptions;
  readonly deadlineAt?: Temporal.Instant;
  readonly from?: Temporal.Instant;
}

/** Resolved schedule-next options split into schedule metadata and run-start options. */
export interface ResolvedScheduleNextOptions {
  readonly schedule: ScheduleNextOptions & { readonly from: Temporal.Instant };
  readonly start: WorkflowStartOptions;
}

/** Single item in a batch workflow-start request. */
export interface WorkflowBatchStartItem<TRawInput = unknown> {
  readonly input: TRawInput;
  readonly options?: WorkflowStartOptions;
}

/** Parent workflow metadata stored on a child workflow run. */
export interface WorkflowRunParentOptions {
  readonly runId: RunId;
  readonly stepId?: StepId;
  readonly stepName?: string;
  readonly stepAttempt?: number;
}

/** Options for executing or resuming a workflow run. */
export interface WorkflowExecutionOptions {
  readonly start?: WorkflowStartOptions;
  readonly signal?: AbortSignal;
}

/** Options for creating a new run from an existing run record. */
export interface WorkflowRerunOptions {
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly workflowVersionResolver?: WorkflowVersionResolver;
  readonly start?: WorkflowStartOptions;
}

/** Options for moving a run back to pending at a new availability time. */
export interface WorkflowRescheduleRunOptions {
  readonly availableAt?: Temporal.Instant;
}

/** Options for releasing an expired worker lease from a run. */
export interface WorkflowReleaseStaleLeaseOptions {
  readonly availableAt?: Temporal.Instant;
}

/** Options for retrying a failed workflow run. */
export interface WorkflowRetryFailedRunOptions {
  readonly availableAt?: Temporal.Instant;
  readonly force?: boolean;
}

/** Options for marking a run as permanently failed. */
export interface WorkflowMarkRunPermanentlyFailedOptions {
  readonly reason: string;
}

/** Options for resuming workflow execution. */
export interface WorkflowResumeOptions {
  readonly signal?: AbortSignal;
}

/** Typed argument tuple used by runnable workflow wrappers. */
export type WorkflowRunArguments<TRawInput, TOptions> = [unknown] extends [TRawInput]
  ? [input: TRawInput, options?: TOptions]
  : [undefined] extends [TRawInput]
    ? [input?: TRawInput, options?: TOptions]
    : [input: TRawInput, options?: TOptions];
