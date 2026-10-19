import type { WorkflowEngine } from "../engine/create.ts";
import type { RegistryLike } from "./definition.ts";
import type { RunId, WorkerId } from "./ids.ts";
import type { ExecutionResult } from "./result.ts";
import type { MissingImplementationRetryConfig } from "./retry.ts";
import type {
  WorkflowAttributeValue,
  RunRecord,
  RunRetryReason,
  RunStatus,
  RunTransitionReason,
} from "./run.ts";

/** Options for creating a direct workflow worker host. */
export interface CreateWorkflowWorkerOptions {
  readonly engine: WorkflowEngine;
  readonly registry: RegistryLike;
  readonly workerId?: WorkerId;
  readonly leaseDuration?: Temporal.Duration;
  readonly pollInterval?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly stopDrainTimeout?: Temporal.Duration;
  readonly missingImplementationRetry?: MissingImplementationRetryConfig;
  readonly now?: () => Temporal.Instant;
}

export interface WorkflowWorker {
  /** Claims and processes a specific run by ID. */
  processRun(runId: RunId): Promise<ExecutionResult<unknown>>;
  /** Claims and processes the next available run matching the optional filters. */
  processNextRun(options?: WorkerRunFilterOptions): Promise<ExecutionResult<unknown> | undefined>;
  /** Extends the worker lease for a claimed run. */
  extendLease(runId: RunId, options?: WorkerLeaseOptions): Promise<RunRecord | undefined>;
  /** Releases the worker lease for a claimed run. */
  releaseLease(runId: RunId, options?: WorkerLeaseOptions): Promise<RunRecord | undefined>;
  /** Runs the worker polling loop until stopped, aborted, or maxRuns is reached. */
  run(options?: WorkerRunOptions): Promise<WorkerRunResult>;
  /** Stops the worker polling loop and waits for active work to settle. */
  stop(): Promise<void>;
}

export interface WorkerLeaseOptions {
  readonly attempts?: number;
}

/** Run filters accepted by workers; worker identity is supplied by the worker itself. */
export interface WorkerRunFilterOptions {
  readonly status?: RunStatus | readonly RunStatus[];
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly idempotencyKey?: string;
  readonly parentRunId?: string;
  readonly parentStepId?: string;
  readonly parentStepName?: string;
  readonly parentStepAttempt?: number;
  readonly lastTransitionReason?: RunTransitionReason | readonly RunTransitionReason[];
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
  readonly retryReason?: RunRetryReason | readonly RunRetryReason[];
  readonly retryAtFrom?: Temporal.Instant;
  readonly retryAtTo?: Temporal.Instant;
  readonly cleanupFinishedAtBefore?: Temporal.Instant;
  readonly attributes?: Readonly<Record<string, WorkflowAttributeValue>>;
  readonly attributeExists?: string | readonly string[];
  readonly attributeMissing?: string | readonly string[];
  readonly limit?: number;
}

export interface WorkerRunOptions extends WorkerRunFilterOptions {
  readonly signal?: AbortSignal;
  readonly maxRuns?: number;
  readonly concurrency?: number;
  readonly pollInterval?: Temporal.Duration;
  readonly tickSchedules?: boolean;
}

export interface WorkerRunResult {
  readonly processedRuns: number;
}

export interface WakeDueRunsOptions extends WorkerRunFilterOptions {
  readonly workerId?: string;
  readonly leaseDuration?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly missingImplementationRetry?: MissingImplementationRetryConfig;
  readonly signal?: AbortSignal;
  readonly maxRuns?: number;
}
