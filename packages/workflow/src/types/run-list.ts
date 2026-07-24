import type { PageOptions } from "./pagination.ts";
import type {
  WorkflowAttributeValue,
  WorkflowRunRetryReason,
  WorkflowRunStatus,
  WorkflowRunTransitionReason,
} from "./run.ts";
import type { WorkflowListStepAttemptsOptions } from "./step-attempts.ts";

/** Filters for listing stored workflow runs. */
export interface WorkflowListRunsOptions {
  readonly status?: WorkflowRunStatus | readonly WorkflowRunStatus[];
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly idempotencyKey?: string;
  readonly workerId?: string;
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

/** Paginated filters for listing stored workflow runs. */
export type WorkflowListRunsPageOptions = WorkflowListRunsOptions & PageOptions;

/** Paginated filters for listing materialized step attempts. */
export type WorkflowListStepAttemptsPageOptions = WorkflowListStepAttemptsOptions & PageOptions;
