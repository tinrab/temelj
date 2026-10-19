import type { WorkflowDefinition } from "./definition.ts";
import type { RunId, StepId } from "./ids.ts";

/** Callback used to resolve the workflow version stored on a new run. */
export type VersionResolver = (
  workflowName: string,
  definition: WorkflowDefinition<unknown, unknown, unknown>,
) => string | undefined | Promise<string | undefined>;

/** Options that control workflow run creation and scheduling. */
export interface StartOptions {
  readonly id?: string;
  readonly idempotencyKey?: string;
  readonly workflowVersion?: string;
  readonly workflowVersionResolver?: VersionResolver;
  readonly context?: unknown;
  readonly parent?: RunParentOptions;
  readonly availableAt?: Temporal.Instant;
  readonly deadlineAt?: Temporal.Instant;
}

/** Options for creating a single delayed workflow run at the next interval boundary. */
export interface ScheduleNextOptions {
  readonly id?: string;
  readonly every: Temporal.Duration;
  readonly idempotencyKey: string;
  readonly workflowVersion?: string;
  readonly workflowVersionResolver?: VersionResolver;
  readonly context?: unknown;
  readonly parent?: RunParentOptions;
  readonly deadlineAt?: Temporal.Instant;
  readonly from?: Temporal.Instant;
}

/** Resolved schedule-next options split into schedule metadata and run-start options. */
export interface ResolvedScheduleNextOptions {
  readonly schedule: ScheduleNextOptions & { readonly from: Temporal.Instant };
  readonly start: StartOptions;
}

export interface BatchStartItem<TRawInput = unknown> {
  readonly input: TRawInput;
  readonly options?: StartOptions;
}

/** Parent workflow metadata stored on a child workflow run. */
export interface RunParentOptions {
  readonly runId: RunId;
  readonly stepId?: StepId;
  readonly stepName?: string;
  readonly stepAttempt?: number;
}

/** Options for executing or resuming a workflow run. */
export interface ExecutionOptions {
  readonly start?: StartOptions;
  readonly signal?: AbortSignal;
}

/** Options for creating a new run from an existing run record. */
export interface RerunOptions {
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly workflowVersionResolver?: VersionResolver;
  readonly start?: StartOptions;
}

/** Options for moving a run back to pending at a new availability time. */
export interface RescheduleRunOptions {
  readonly availableAt?: Temporal.Instant;
}

/** Options for releasing an expired worker lease from a run. */
export interface ReleaseStaleLeaseOptions {
  readonly availableAt?: Temporal.Instant;
}

export interface RetryFailedRunOptions {
  readonly availableAt?: Temporal.Instant;
  readonly force?: boolean;
}

export interface MarkRunPermanentlyFailedOptions {
  readonly reason: string;
}

export interface ResumeOptions {
  readonly signal?: AbortSignal;
}

/** Typed argument tuple used by runnable workflow wrappers. */
export type RunArguments<TRawInput, TOptions> = [unknown] extends [TRawInput]
  ? [input: TRawInput, options?: TOptions]
  : [undefined] extends [TRawInput]
    ? [input?: TRawInput, options?: TOptions]
    : [input: TRawInput, options?: TOptions];
