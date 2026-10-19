import { type StorageValue } from "@temelj/storage";

import type { WorkflowErrorRecord } from "./error.ts";
import type { RunId, StepId, WorkerId } from "./ids.ts";
import type { TelemetryContext } from "./telemetry.ts";

/** Validation issue describing why a value cannot be stored in workflow history. */
export interface ValueIssue {
  readonly path: string;
  readonly message: string;
}

export type WorkflowAttributeValue = string | number | boolean | null;

export type RunAttributes = Readonly<Record<string, WorkflowAttributeValue>>;

export type AttributePatch = Readonly<Record<string, WorkflowAttributeValue | undefined>>;

export type RunStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "canceled";

export type TerminalRunStatus = "completed" | "failed" | "canceled";

export type StepType =
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
export interface StepIdentity<TType extends StepType = StepType> {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly kind: TType;
}

export type MaterializedStepType =
  | "run"
  | "sleep"
  | "workflow"
  | "message-send"
  | "message-wait"
  | "stream"
  | "deterministic";

export type RunRetryReason = "workflow" | "step" | "missing_implementation";

export type RunTransitionReason =
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

/** How a run is keyed, and where it sits under a parent run. */
export interface RunLinks {
  readonly idempotencyKey?: string;
  readonly parentRunId?: RunId;
  readonly parentStepId?: StepId;
  readonly parentStepName?: string;
  readonly parentStepAttempt?: number;
}

export interface RunRecord<TInput = StorageValue, TOutput = StorageValue> extends RunLinks {
  readonly id: RunId;
  readonly namespace: string;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly status: RunStatus;
  readonly input?: TInput;
  readonly context?: StorageValue;
  readonly telemetryContext?: TelemetryContext;
  readonly metadata?: StorageValue;
  readonly attributes?: RunAttributes;
  readonly output?: TOutput;
  readonly error?: WorkflowErrorRecord;
  readonly attempts?: number;
  readonly workerId?: WorkerId;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly lastTransitionAt: Temporal.Instant;
  readonly lastTransitionReason: RunTransitionReason;
  readonly availableAt?: Temporal.Instant;
  readonly retryAt?: Temporal.Instant;
  readonly retryReason?: RunRetryReason;
  readonly retryAttempt?: number;
  readonly retryStepId?: StepId;
  readonly retryStepName?: string;
  readonly deadlineAt?: Temporal.Instant;
  readonly leaseExpiresAt?: Temporal.Instant;
  readonly startedAt?: Temporal.Instant;
  readonly finishedAt?: Temporal.Instant;
}

export interface WorkflowLifecycleEvent {
  readonly run: RunRecord;
  readonly previousRun?: RunRecord;
  readonly status: RunStatus;
  readonly reason: RunTransitionReason;
  readonly timestamp: Temporal.Instant;
  readonly workflowName: string;
  readonly workflowVersion?: string;
}

export type WorkflowLifecycleCallback = (event: WorkflowLifecycleEvent) => void | Promise<void>;
