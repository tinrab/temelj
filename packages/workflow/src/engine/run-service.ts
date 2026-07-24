import type { WorkflowDefinition } from "../types/definition.ts";
import type { WorkflowHandle } from "../types/result.ts";
import type {
  WorkflowMarkRunPermanentlyFailedOptions,
  WorkflowReleaseStaleLeaseOptions,
  WorkflowRerunOptions,
  WorkflowRescheduleRunOptions,
  WorkflowRetryFailedRunOptions,
  WorkflowStartOptions,
} from "../types/run-options.ts";
import type {
  RunId,
  WorkflowAttributePatch,
  WorkflowRunRecord,
  WorkflowRunWorkflowName,
  WorkflowRunWorkflowVersion,
} from "../types/run.ts";
import type {
  WorkflowEventReader,
  WorkflowLockConditionalWriterRepository,
  WorkflowLockListerRepository,
  WorkflowRunReaderRepository,
  WorkflowRunWriterRepository,
  WorkflowStepAttemptLookup,
} from "../types/store.ts";

import { normalizeWorkflowAttributePatch } from "../attributes.ts";
import { defineWorkflowFromName } from "../definition.ts";
import { WorkflowPermanentFailureError, WorkflowStateError } from "../errors/mod.ts";
import { isScheduledWorkflowRunStatus, nextRunAttempt } from "../utility.ts";
import { MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS } from "./retry-policy.ts";
import { serializeError, toPersistedValue } from "./serialization.ts";
import {
  cancelRunWithChildren,
  getRequiredRun,
  transitionRunToManualRetry,
  transitionRunToPermanentFailure,
  releaseLocksForRun,
  transitionRunToRescheduled,
  setRunAttributesIfCurrent,
  transitionRunAfterStaleLeaseRelease,
  updateRunMetadataIfCurrent,
} from "./state.ts";

type WorkflowRunServiceStore = WorkflowRunReaderRepository &
  WorkflowRunWriterRepository &
  WorkflowEventReader &
  WorkflowStepAttemptLookup &
  WorkflowLockListerRepository &
  WorkflowLockConditionalWriterRepository;

interface WorkflowRunServiceOptions {
  readonly store: WorkflowRunServiceStore;
  readonly now: () => Temporal.Instant;
  readonly limits: {
    readonly maximumPersistedValueBytes?: number;
  };
}

interface WorkflowRunLifecycleEmitter {
  readonly emitLifecycleEvent: (
    next: WorkflowRunRecord,
    previous: WorkflowRunRecord,
  ) => void | Promise<void>;
}

interface WorkflowRunMetadataUpdateEmitter {
  readonly emitRunMetadataUpdated: (next: WorkflowRunRecord, previous: WorkflowRunRecord) => void;
}

export async function rerunWorkflowRun(
  service: WorkflowRunServiceOptions,
  startWorkflow: <TOutput = unknown>(
    definition: WorkflowDefinition<unknown, TOutput, unknown>,
    input: unknown,
    options?: WorkflowStartOptions,
  ) => Promise<WorkflowHandle<TOutput>>,
  runId: RunId,
  rerunOptions: WorkflowRerunOptions | undefined,
): Promise<WorkflowHandle<unknown>> {
  const sourceRun = await getRequiredRun(service.store, runId);
  const options = rerunOptions;
  const definition = await resolveRerunWorkflowDefinition(sourceRun, options);
  const start = options?.start;
  return await startWorkflow(definition, sourceRun.input, {
    ...(sourceRun.context === undefined ? {} : { context: sourceRun.context }),
    ...start,
  });
}

export async function resolveRerunWorkflowDefinition(
  sourceRun: WorkflowRerunSourceRun,
  options: WorkflowRerunOptions | undefined,
): Promise<WorkflowDefinition<unknown, unknown, unknown>> {
  const workflowName = options?.workflowName ?? sourceRun.workflowName;
  const workflowVersion =
    options !== undefined && "workflowVersion" in options
      ? options.workflowVersion
      : sourceRun.workflowVersion;
  const resolvedWorkflowVersion = await resolveWorkflowVersion(
    workflowName,
    workflowVersion,
    options?.workflowVersionResolver,
  );
  return defineWorkflowFromName(workflowName, resolvedWorkflowVersion);
}

interface WorkflowRerunSourceRun {
  readonly workflowName: WorkflowRunWorkflowName;
  readonly workflowVersion?: WorkflowRunWorkflowVersion;
}

export async function rescheduleWorkflowRun(
  service: WorkflowRunServiceOptions,
  lifecycle: WorkflowRunLifecycleEmitter,
  runId: RunId,
  rescheduleOptions: WorkflowRescheduleRunOptions | undefined,
): Promise<WorkflowRunRecord> {
  const options = rescheduleOptions;
  const now = service.now();
  const availableAt = options?.availableAt ?? now;
  for (let attempt = 0; attempt < MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS; attempt++) {
    const current = await getRequiredRun(service.store, runId);
    if (!isScheduledWorkflowRunStatus(current.status)) {
      WorkflowStateError.runCannotBeRescheduled(runId);
    }
    if (
      current.availableAt !== undefined &&
      Temporal.Instant.compare(current.availableAt, availableAt) === 0 &&
      current.lastTransitionReason === "rescheduled"
    ) {
      return current;
    }
    const updated = await service.store.updateRunIfCurrent(
      current,
      transitionRunToRescheduled(current, now, availableAt),
    );
    if (updated !== undefined) {
      await releaseLocksForRun(service.store, updated.id, now);
      await lifecycle.emitLifecycleEvent(updated, current);
      return updated;
    }
  }
  WorkflowStateError.failedRunReschedule(runId);
}

export async function releaseStaleWorkflowRunLease(
  service: WorkflowRunServiceOptions,
  lifecycle: WorkflowRunLifecycleEmitter,
  runId: RunId,
  releaseOptions: WorkflowReleaseStaleLeaseOptions | undefined,
): Promise<WorkflowRunRecord> {
  const options = releaseOptions;
  const now = service.now();
  const availableAt = options?.availableAt ?? now;
  for (let attempt = 0; attempt < MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS; attempt++) {
    const current = await getRequiredRun(service.store, runId);
    if (isScheduledWorkflowRunStatus(current.status)) {
      return current;
    }
    if (current.status !== "running") {
      WorkflowStateError.staleLeaseReleaseRequiresRunning(runId);
    }
    if (
      current.workerId !== undefined &&
      typeof current.workerId === "string" &&
      current.workerId.trim() !== "" &&
      current.leaseExpiresAt !== undefined &&
      Temporal.Instant.compare(current.leaseExpiresAt, now) > 0
    ) {
      WorkflowStateError.runLeaseStillActive(runId);
    }
    const updated = await service.store.updateRunIfCurrent(
      current,
      transitionRunAfterStaleLeaseRelease(current, now, availableAt),
    );
    if (updated !== undefined) {
      await lifecycle.emitLifecycleEvent(updated, current);
      return updated;
    }
  }
  WorkflowStateError.failedStaleRunLeaseRelease(runId);
}

export async function retryFailedWorkflowRun(
  service: WorkflowRunServiceOptions,
  lifecycle: WorkflowRunLifecycleEmitter,
  runId: RunId,
  retryOptions: WorkflowRetryFailedRunOptions | undefined,
): Promise<WorkflowRunRecord> {
  const options = retryOptions;
  const now = service.now();
  const availableAt = options?.availableAt ?? now;
  for (let attempt = 0; attempt < MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS; attempt++) {
    const current = await getRequiredRun(service.store, runId);
    if (isScheduledWorkflowRunStatus(current.status)) {
      return current;
    }
    if (current.status !== "failed") {
      WorkflowStateError.runRetryRequiresFailed(runId);
    }
    if (current.lastTransitionReason === "permanent_failure" && options?.force !== true) {
      WorkflowStateError.runRetryRequiresForceAfterPermanentFailure(runId);
    }
    if (
      options?.force !== true &&
      current.retryReason === undefined &&
      current.retryAt === undefined
    ) {
      WorkflowStateError.failedRunRetryRequiresForce(runId);
    }
    const retryAttempt = nextRunAttempt(current.retryAttempt);
    const updated = await service.store.updateRunIfCurrent(
      current,
      transitionRunToManualRetry(current, now, availableAt, retryAttempt),
    );
    if (updated !== undefined) {
      await lifecycle.emitLifecycleEvent(updated, current);
      return updated;
    }
  }
  WorkflowStateError.failedRunRetry(runId);
}

export async function markWorkflowRunPermanentlyFailed(
  service: WorkflowRunServiceOptions,
  lifecycle: WorkflowRunLifecycleEmitter,
  runId: RunId,
  permanentFailureOptions: WorkflowMarkRunPermanentlyFailedOptions,
): Promise<WorkflowRunRecord> {
  const now = service.now();
  const reason = permanentFailureOptions.reason;
  for (let attempt = 0; attempt < MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS; attempt++) {
    const current = await getRequiredRun(service.store, runId);
    if (current.status === "completed" || current.status === "canceled") {
      WorkflowStateError.permanentFailureInvalidStatus(runId, current.status);
    }
    if (
      current.status === "failed" &&
      current.lastTransitionReason === "permanent_failure" &&
      current.error?.details?.reason === reason
    ) {
      return current;
    }
    const updated = await service.store.updateRunIfCurrent(
      current,
      transitionRunToPermanentFailure(
        current,
        serializeError(WorkflowPermanentFailureError.create({ runId, reason })),
        now,
      ),
    );
    if (updated !== undefined) {
      await lifecycle.emitLifecycleEvent(updated, current);
      return updated;
    }
  }
  WorkflowStateError.failedPermanentRunFailure(runId);
}

export async function updateWorkflowRunMetadata(
  service: WorkflowRunServiceOptions,
  lifecycle: WorkflowRunMetadataUpdateEmitter,
  runId: RunId,
  metadata: unknown,
): Promise<WorkflowRunRecord> {
  const persistedMetadata = toPersistedValue(metadata, "workflow run metadata", service.limits);
  const timestamp = service.now();
  const previousRun = await getRequiredRun(service.store, runId);
  const updatedRun = await updateRunMetadataIfCurrent(
    service.store,
    runId,
    persistedMetadata,
    timestamp,
  );
  lifecycle.emitRunMetadataUpdated(updatedRun, previousRun);
  return updatedRun;
}

export async function setWorkflowRunAttributes(
  service: WorkflowRunServiceOptions,
  runId: RunId,
  attributes: WorkflowAttributePatch,
): Promise<WorkflowRunRecord> {
  const normalized = normalizeWorkflowAttributePatch(attributes);
  const timestamp = service.now();
  return await setRunAttributesIfCurrent(service.store, runId, normalized, timestamp);
}

export async function cancelWorkflowRun(
  service: WorkflowRunServiceOptions,
  lifecycle: WorkflowRunLifecycleEmitter,
  runId: RunId,
): Promise<WorkflowRunRecord> {
  const previousRun = await getRequiredRun(service.store, runId);
  const canceledRun = await cancelRunWithChildren(service.store, runId, service.now());
  if (previousRun.status !== "canceled") {
    await lifecycle.emitLifecycleEvent(canceledRun, previousRun);
  }
  return canceledRun;
}

export async function resolveWorkflowVersion(
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
  const resolved = await resolver(
    workflowName,
    defineWorkflowFromName(workflowName, fallbackVersion),
  );
  return typeof resolved === "string" && resolved.trim() !== "" ? resolved : fallbackVersion;
}

export async function resolveWorkflowStartSpec<TInput, TOutput, TRawInput>(
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  options: WorkflowStartOptions | undefined,
): Promise<WorkflowDefinition<TInput, TOutput, TRawInput>> {
  const version = await resolveWorkflowVersion(
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
      ...(version === undefined ? { version: undefined } : { version }),
    },
  };
}
