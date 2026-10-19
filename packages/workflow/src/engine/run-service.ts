import type { StorageValue } from "@temelj/storage";

import type {
  CleanupRunsOptions,
  CleanupRunsResult,
  RetentionPolicyOptions,
} from "../types/cleanup.ts";
import type { WorkflowDefinition } from "../types/definition.ts";
import type { RunId } from "../types/ids.ts";
import type {
  MarkRunPermanentlyFailedOptions,
  ReleaseStaleLeaseOptions,
  RerunOptions,
  RescheduleRunOptions,
  RetryFailedRunOptions,
  StartOptions,
} from "../types/run-options.ts";
import type { AttributePatch, RunRecord } from "../types/run.ts";
import type { EngineContext } from "./context.ts";
import type { WorkflowEngine } from "./create.ts";
import type { RunRef } from "./start.ts";

import { normalizeAttributePatch } from "../attributes.ts";
import { defineFromName } from "../definition.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowPermanentFailureError, WorkflowStateError } from "../errors/mod.ts";
import { isScheduledRunStatus, nextRunAttempt } from "../run-status.ts";
import { getRequiredRun } from "../store/query.ts";
import { retentionCleanupOptions } from "./run-utils.ts";
import { serializeError, toPersistedValue } from "./serialization.ts";
import {
  cancelRunWithChildren,
  MAX_RUN_UPDATE_ATTEMPTS,
  transitionRunToManualRetry,
  releaseLocksForRun,
  transitionRunToRescheduled,
  setRunAttributesIfCurrent,
  transitionRunAfterStaleLeaseRelease,
  updateRunMetadataIfCurrent,
  transitionRunToFailed,
} from "./state.ts";

interface RunLifecycleEmitter {
  readonly emitLifecycleEvent: (next: RunRecord, previous: RunRecord) => void | Promise<void>;
}

interface RunMetadataUpdateEmitter {
  readonly emitRunMetadataUpdated: (next: RunRecord, previous: RunRecord) => void;
}

export async function rerunRun(
  context: EngineContext,
  startWorkflow: WorkflowEngine["startWorkflow"],
  runId: RunId,
  rerunOptions: RerunOptions | undefined,
): Promise<RunRef<unknown>> {
  const sourceRun = await getRequiredRun(context.store, runId);
  const definition = await resolveRerunDefinition(sourceRun, rerunOptions);
  const start = rerunOptions?.start;

  const contextOptions: StartOptions = {
    context: sourceRun.context,
  };

  return await startWorkflow(definition, sourceRun.input, { ...contextOptions, ...start });
}

async function resolveRerunDefinition(
  sourceRun: RerunSourceRun,
  options: RerunOptions | undefined,
): Promise<WorkflowDefinition<unknown, unknown, unknown>> {
  const workflowName = options?.workflowName ?? sourceRun.workflowName;

  const workflowVersion =
    options !== undefined && "workflowVersion" in options
      ? options.workflowVersion
      : sourceRun.workflowVersion;

  const resolvedWorkflowVersion = await resolveVersion(
    workflowName,
    workflowVersion,
    options?.workflowVersionResolver,
  );

  return defineFromName(workflowName, resolvedWorkflowVersion);
}

interface RerunSourceRun {
  readonly workflowName: string;
  readonly workflowVersion?: string;
}

interface RunOperation {
  /**
   * The record to write, or `undefined` when the run already has the requested state. Throws
   * when the run cannot take the change.
   */
  readonly next: (current: RunRecord) => RunRecord | undefined;
  readonly failureMessage: string;
  readonly failureCode: WorkflowErrorCode;
  readonly afterUpdate?: (updated: RunRecord) => Promise<void>;
}

/** Applies an operator change to a run, retrying when another writer updates the run first. */
async function applyRunOperation(
  context: EngineContext,
  lifecycle: RunLifecycleEmitter,
  runId: RunId,
  operation: RunOperation,
): Promise<RunRecord> {
  for (let attempt = 0; attempt < MAX_RUN_UPDATE_ATTEMPTS; attempt++) {
    const current = await getRequiredRun(context.store, runId);
    const next = operation.next(current);

    if (next === undefined) {
      return current;
    }

    const updated = await context.store.updateRunIfCurrent(current, next);

    if (updated !== undefined) {
      await operation.afterUpdate?.(updated);
      await lifecycle.emitLifecycleEvent(updated, current);

      return updated;
    }
  }

  throw new WorkflowStateError(operation.failureMessage, {
    code: operation.failureCode,
    details: { runId },
  });
}

function stateError(message: string, code: WorkflowErrorCode, runId: RunId): WorkflowStateError {
  return new WorkflowStateError(message, { code, details: { runId } });
}

export async function rescheduleWorkflowRun(
  context: EngineContext,
  lifecycle: RunLifecycleEmitter,
  runId: RunId,
  rescheduleOptions: RescheduleRunOptions | undefined,
): Promise<RunRecord> {
  const now = context.now();
  const availableAt = rescheduleOptions?.availableAt ?? now;

  return await applyRunOperation(context, lifecycle, runId, {
    next: (current) => {
      if (!isScheduledRunStatus(current.status)) {
        throw stateError(
          `Workflow run cannot be rescheduled unless pending or waiting: ${runId}`,
          WorkflowErrorCode.STATE_RUN_CANNOT_BE_RESCHEDULED,
          runId,
        );
      }

      const unchanged =
        current.availableAt !== undefined &&
        Temporal.Instant.compare(current.availableAt, availableAt) === 0 &&
        current.lastTransitionReason === "rescheduled";

      return unchanged ? undefined : transitionRunToRescheduled(current, now, availableAt);
    },
    afterUpdate: async (updated) => {
      await releaseLocksForRun(context.store, updated.id, now);
    },
    failureMessage: `Failed to reschedule workflow run ${runId}`,
    failureCode: WorkflowErrorCode.STATE_RUN_RESCHEDULE_FAILED,
  });
}

export async function releaseStaleWorkflowRunLease(
  context: EngineContext,
  lifecycle: RunLifecycleEmitter,
  runId: RunId,
  releaseOptions: ReleaseStaleLeaseOptions | undefined,
): Promise<RunRecord> {
  const now = context.now();
  const availableAt = releaseOptions?.availableAt ?? now;

  return await applyRunOperation(context, lifecycle, runId, {
    next: (current) => {
      if (isScheduledRunStatus(current.status)) {
        return undefined;
      }

      if (current.status !== "running") {
        throw stateError(
          `Workflow run stale lease cannot be released unless running: ${runId}`,
          WorkflowErrorCode.STATE_STALE_LEASE_RELEASE_REQUIRES_RUNNING,
          runId,
        );
      }

      if (
        current.workerId !== undefined &&
        current.workerId.trim() !== "" &&
        current.leaseExpiresAt !== undefined &&
        Temporal.Instant.compare(current.leaseExpiresAt, now) > 0
      ) {
        throw stateError(
          `Workflow run lease is still active: ${runId}`,
          WorkflowErrorCode.STATE_RUN_LEASE_STILL_ACTIVE,
          runId,
        );
      }

      return transitionRunAfterStaleLeaseRelease(current, now, availableAt);
    },
    failureMessage: `Failed to release stale workflow run lease ${runId}`,
    failureCode: WorkflowErrorCode.STATE_STALE_RUN_LEASE_RELEASE_FAILED,
  });
}

export async function retryFailedWorkflowRun(
  context: EngineContext,
  lifecycle: RunLifecycleEmitter,
  runId: RunId,
  retryOptions: RetryFailedRunOptions | undefined,
): Promise<RunRecord> {
  const now = context.now();
  const availableAt = retryOptions?.availableAt ?? now;
  const force = retryOptions?.force === true;

  return await applyRunOperation(context, lifecycle, runId, {
    next: (current) => {
      if (isScheduledRunStatus(current.status)) {
        return undefined;
      }

      if (current.status !== "failed") {
        throw stateError(
          `Workflow run cannot be retried unless failed: ${runId}`,
          WorkflowErrorCode.STATE_RUN_RETRY_REQUIRES_FAILED,
          runId,
        );
      }

      if (current.lastTransitionReason === "permanent_failure" && !force) {
        throw stateError(
          `Workflow run cannot be retried after permanent failure without force: ${runId}`,
          WorkflowErrorCode.STATE_RUN_RETRY_REQUIRES_FORCE_AFTER_PERMANENT_FAILURE,
          runId,
        );
      }

      if (!force && current.retryReason === undefined && current.retryAt === undefined) {
        throw stateError(
          `Workflow failed run retry requires force when no retry metadata exists: ${runId}`,
          WorkflowErrorCode.STATE_FAILED_RUN_RETRY_REQUIRES_FORCE,
          runId,
        );
      }

      return transitionRunToManualRetry(
        current,
        now,
        availableAt,
        nextRunAttempt(current.retryAttempt),
      );
    },
    failureMessage: `Failed to retry workflow run ${runId}`,
    failureCode: WorkflowErrorCode.STATE_RUN_RETRY_FAILED,
  });
}

export async function markWorkflowRunPermanentlyFailed(
  context: EngineContext,
  lifecycle: RunLifecycleEmitter,
  runId: RunId,
  permanentFailureOptions: MarkRunPermanentlyFailedOptions,
): Promise<RunRecord> {
  const now = context.now();
  const reason = permanentFailureOptions.reason;

  return await applyRunOperation(context, lifecycle, runId, {
    next: (current) => {
      if (current.status === "completed" || current.status === "canceled") {
        throw new WorkflowStateError(
          `Workflow run cannot be marked permanently failed from ${current.status}: ${runId}`,
          {
            code: WorkflowErrorCode.STATE_PERMANENT_FAILURE_STATUS_INVALID,
            details: { runId, status: current.status },
          },
        );
      }

      if (
        current.status === "failed" &&
        current.lastTransitionReason === "permanent_failure" &&
        current.error?.details?.reason === reason
      ) {
        return undefined;
      }

      return transitionRunToFailed(
        current,
        serializeError(new WorkflowPermanentFailureError({ runId, reason })),
        now,
        "permanent_failure",
      );
    },
    failureMessage: `Failed to mark workflow run permanently failed ${runId}`,
    failureCode: WorkflowErrorCode.STATE_PERMANENT_RUN_FAILURE_FAILED,
  });
}

export async function updateWorkflowRunMetadata(
  context: EngineContext,
  lifecycle: RunMetadataUpdateEmitter,
  runId: RunId,
  metadata: StorageValue,
): Promise<RunRecord> {
  const persistedMetadata = toPersistedValue(metadata, "workflow run metadata", context.limits);
  const timestamp = context.now();
  const previousRun = await getRequiredRun(context.store, runId);

  const updatedRun = await updateRunMetadataIfCurrent(
    context.store,
    runId,
    persistedMetadata,
    timestamp,
  );

  lifecycle.emitRunMetadataUpdated(updatedRun, previousRun);

  return updatedRun;
}

export async function setRunAttributes(
  context: EngineContext,
  runId: RunId,
  attributes: AttributePatch,
): Promise<RunRecord> {
  const normalized = normalizeAttributePatch(attributes);
  const timestamp = context.now();

  return await setRunAttributesIfCurrent(context.store, runId, normalized, timestamp);
}

export async function cancelWorkflowRun(
  context: EngineContext,
  lifecycle: RunLifecycleEmitter,
  runId: RunId,
): Promise<RunRecord> {
  const previousRun = await getRequiredRun(context.store, runId);
  const canceledRun = await cancelRunWithChildren(context.store, runId, context.now());

  if (previousRun.status !== "canceled") {
    await lifecycle.emitLifecycleEvent(canceledRun, previousRun);
  }

  return canceledRun;
}

async function resolveVersion(
  workflowName: string,
  fallbackVersion: string | undefined,
  resolver:
    | ((
        workflowName: string,
        definition: WorkflowDefinition<unknown, unknown, unknown>,
      ) => string | undefined | Promise<string | undefined>)
    | undefined,
): Promise<string | undefined> {
  if (resolver === undefined) {
    return fallbackVersion;
  }

  const resolved = await resolver(workflowName, defineFromName(workflowName, fallbackVersion));

  return resolved !== undefined && resolved.trim() !== "" ? resolved : fallbackVersion;
}

export async function resolveStartSpec<TInput, TOutput, TRawInput>(
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  options: StartOptions | undefined,
): Promise<WorkflowDefinition<TInput, TOutput, TRawInput>> {
  const version = await resolveVersion(
    definition.name,
    options?.workflowVersion ?? definition.version,
    options?.workflowVersionResolver,
  );

  if (version === definition.version) {
    return definition;
  }

  return {
    ...definition,
    version,
    config: {
      ...definition.config,
      version,
    },
  };
}

export async function cleanupRuns(
  context: EngineContext,
  options: CleanupRunsOptions,
): Promise<CleanupRunsResult> {
  const result = await context.store.cleanupRuns(options);
  context.observation.emitCleanupCompleted(result);

  return result;
}

export async function applyRetentionPolicy(
  context: EngineContext,
  options: RetentionPolicyOptions,
): Promise<CleanupRunsResult> {
  const result = await context.store.cleanupRuns(retentionCleanupOptions(options, context.now));
  context.observation.emitRetentionApplied(result);

  return result;
}
