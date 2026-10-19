import type { RunId, StepId } from "./ids.ts";

/** Stored lease-backed workflow lock state. */
export interface LockRecord {
  readonly key: string;
  readonly namespace: string;
  readonly holderId: string;
  readonly holderRunId?: RunId;
  readonly holderStepId?: StepId;
  readonly fencingToken: number;
  readonly acquiredAt: Temporal.Instant;
  readonly leaseExpiresAt: Temporal.Instant;
  readonly releasedAt?: Temporal.Instant;
}

export interface AcquireLockOptions {
  readonly holderId: string;
  readonly holderRunId?: RunId;
  readonly holderStepId?: StepId;
  readonly leaseDuration: Temporal.Duration;
  readonly wait?: boolean;
  readonly waitTimeout?: Temporal.Duration;
  readonly waitDeadlineAt?: Temporal.Instant;
  readonly now?: Temporal.Instant;
}

export interface StepAcquireLockOptions {
  readonly holderId?: string;
  readonly leaseDuration: Temporal.Duration;
  readonly wait?: boolean;
  readonly waitTimeout?: Temporal.Duration;
  readonly now?: Temporal.Instant;
}

export interface StepReleaseLockOptions {
  readonly holderId?: string;
  readonly now?: Temporal.Instant;
}

/** Options for releasing a workflow lock outside workflow step execution. */
export interface ReleaseLockOptions {
  readonly holderId: string;
  readonly now?: Temporal.Instant;
}

/** Options for releasing a workflow lock whose lease has expired. */
export interface ReleaseStaleLockOptions {
  readonly now?: Temporal.Instant;
}
