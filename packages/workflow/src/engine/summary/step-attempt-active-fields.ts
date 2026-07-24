import { optionalProperty } from "../../collection.ts";
import { StepId } from "../../types/step.ts";

export interface WorkflowStepAttemptActiveStartedSummaryFields {
  readonly oldestStartedAt?: Temporal.Instant;
}

export interface WorkflowStepAttemptActiveTimeoutSummaryFields {
  readonly nextTimeoutAt?: Temporal.Instant;
  readonly nextTimeoutStepId?: StepId;
  readonly nextTimeoutAttemptKey?: string;
}

export interface WorkflowStepAttemptActiveStartedAccumulator {
  readonly oldestStartedAt?: Temporal.Instant;
}

export interface WorkflowStepAttemptActiveTimeoutAccumulator {
  readonly nextTimeoutAt?: Temporal.Instant;
  readonly nextTimeoutStepId?: StepId;
  readonly nextTimeoutAttemptKey?: string;
}

export function finishWorkflowStepAttemptActiveStartedSummary(
  activeAttempt: WorkflowStepAttemptActiveStartedAccumulator,
): WorkflowStepAttemptActiveStartedSummaryFields {
  return optionalProperty("oldestStartedAt", activeAttempt.oldestStartedAt);
}

export function finishWorkflowStepAttemptActiveTimeoutSummary(
  activeAttempt: WorkflowStepAttemptActiveTimeoutAccumulator,
): WorkflowStepAttemptActiveTimeoutSummaryFields {
  return activeAttempt.nextTimeoutAt === undefined
    ? {}
    : {
        nextTimeoutAt: activeAttempt.nextTimeoutAt,
        ...optionalProperty("nextTimeoutStepId", activeAttempt.nextTimeoutStepId),
        ...optionalProperty("nextTimeoutAttemptKey", activeAttempt.nextTimeoutAttemptKey),
      };
}
