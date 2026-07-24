import type { RegistryLike } from "./definition.ts";
import type { WorkflowWorkerEngine } from "./engine.ts";
import type { ExecutionResult } from "./result.ts";
import type { WorkflowMissingImplementationRetryConfig } from "./retry.ts";
import type {
  RunId,
  WorkflowAttributeValue,
  WorkflowRunRecord,
  WorkflowRunRetryReason,
  WorkflowRunStatus,
  WorkflowRunTransitionReason,
} from "./run.ts";
import type { WorkerId } from "./worker-id.ts";

/** Options for creating a direct workflow worker host. */
export interface CreateWorkflowWorkerOptions {
  readonly engine: WorkflowWorkerEngine;
  readonly registry: RegistryLike;
  readonly workerId?: WorkerId;
  readonly leaseDuration?: Temporal.Duration;
  readonly pollInterval?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly stopDrainTimeout?: Temporal.Duration;
  readonly missingImplementationRetry?: WorkflowMissingImplementationRetryConfig;
  readonly now?: () => Temporal.Instant;
}

/** Describes the workflow worker contract. */
export interface WorkflowWorker {
  /** Claims and processes a specific run by ID. */
  processRun(runId: RunId): Promise<ExecutionResult<unknown>>;
  /** Claims and processes the next available run matching the optional filters. */
  processNextRun(
    options?: WorkflowWorkerRunFilterOptions,
  ): Promise<ExecutionResult<unknown> | undefined>;
  /** Extends the worker lease for a claimed run. */
  extendLease(
    runId: RunId,
    options?: WorkflowWorkerLeaseOptions,
  ): Promise<WorkflowRunRecord | undefined>;
  /** Releases the worker lease for a claimed run. */
  releaseLease(
    runId: RunId,
    options?: WorkflowWorkerLeaseOptions,
  ): Promise<WorkflowRunRecord | undefined>;
  /** Runs the worker polling loop until stopped, aborted, or maxRuns is reached. */
  run(options?: WorkflowWorkerRunOptions): Promise<WorkflowWorkerRunResult>;
  /** Stops the worker polling loop and waits for active work to settle. */
  stop(): Promise<void>;
}

/** Options for workflow worker lease. */
export interface WorkflowWorkerLeaseOptions {
  readonly attempts?: number;
}

/** Run filters accepted by workers; worker identity is supplied by the worker itself. */
export interface WorkflowWorkerRunFilterOptions {
  readonly status?: WorkflowRunStatus | readonly WorkflowRunStatus[];
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly idempotencyKey?: string;
  readonly parentRunId?: string;
  readonly parentStepId?: string;
  readonly parentStepName?: string;
  readonly parentStepAttempt?: number;
  readonly lastTransitionReason?:
    | WorkflowRunTransitionReason
    | readonly WorkflowRunTransitionReason[];
  readonly createdAtFrom?: Temporal.Instant;
  readonly createdAtTo?: Temporal.Instant;
  readonly updatedAtFrom?: Temporal.Instant;
  readonly updatedAtTo?: Temporal.Instant;
  readonly finishedAtFrom?: Temporal.Instant;
  readonly finishedAtTo?: Temporal.Instant;
  readonly startedAtFrom?: Temporal.Instant;
  readonly startedAtTo?: Temporal.Instant;
  readonly availableAtFrom?: Temporal.Instant;
  readonly availableAtTo?: Temporal.Instant;
  readonly leaseExpiresAtFrom?: Temporal.Instant;
  readonly leaseExpiresAtTo?: Temporal.Instant;
  readonly retryReason?: WorkflowRunRetryReason | readonly WorkflowRunRetryReason[];
  readonly retryAtFrom?: Temporal.Instant;
  readonly retryAtTo?: Temporal.Instant;
  readonly cleanupFinishedAtBefore?: Temporal.Instant;
  readonly attributes?: Readonly<Record<string, WorkflowAttributeValue>>;
  readonly attributeExists?: string | readonly string[];
  readonly attributeMissing?: string | readonly string[];
  readonly limit?: number;
}

/** Options for workflow worker run. */
export interface WorkflowWorkerRunOptions extends WorkflowWorkerRunFilterOptions {
  readonly signal?: AbortSignal;
  readonly maxRuns?: number;
  readonly concurrency?: number;
  readonly pollInterval?: Temporal.Duration;
  readonly tickSchedules?: boolean;
}

/** Result returned by workflow worker run. */
export interface WorkflowWorkerRunResult {
  readonly processedRuns: number;
}

/** Options for workflow wake due runs. */
export interface WorkflowWakeDueRunsOptions extends WorkflowWorkerRunFilterOptions {
  readonly workerId?: string;
  readonly leaseDuration?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly missingImplementationRetry?: WorkflowMissingImplementationRetryConfig;
  readonly signal?: AbortSignal;
  readonly maxRuns?: number;
}
