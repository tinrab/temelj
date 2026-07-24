import { z } from "zod";

import type { RunId } from "./run.ts";
import type { StepId } from "./step-id.ts";

import {
  temporalInstantSchema,
  nonBlankStringSchema,
  positiveSafeIntegerSchema,
} from "./common.ts";
import { runIdSchema } from "./run-id.ts";
import { stepIdSchema } from "./step-id.ts";

export const workflowLockRecordSchema = z.object({
  key: nonBlankStringSchema,
  namespace: nonBlankStringSchema,
  holderId: nonBlankStringSchema,
  holderRunId: runIdSchema.optional(),
  holderStepId: stepIdSchema.optional(),
  fencingToken: positiveSafeIntegerSchema,
  acquiredAt: temporalInstantSchema,
  leaseExpiresAt: temporalInstantSchema,
  releasedAt: temporalInstantSchema.optional(),
});

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

/** Options for acquiring a workflow lock. */
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

/** Options for acquiring a workflow lock from a durable step. */
export interface WorkflowStepAcquireLockOptions {
  readonly holderId?: string;
  readonly leaseDuration: Temporal.Duration;
  readonly wait?: boolean;
  readonly waitTimeout?: Temporal.Duration;
  readonly now?: Temporal.Instant;
}

/** Options for releasing a workflow lock from a durable step. */
export interface WorkflowStepReleaseLockOptions {
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
