import type { ObservationEventMap } from "./types/observation.ts";
import type {
  RunTelemetryContext,
  StepTelemetryContext,
  StorageTelemetryContext,
  Telemetry,
  TelemetryContext,
} from "./types/telemetry.ts";

/** Instrumentation scope used by workflow telemetry adapters. */
export const WORKFLOW_INSTRUMENTATION_NAME = "temelj.workflow";

/** Version of the built-in workflow telemetry instrumentation. */
export const WORKFLOW_INSTRUMENTATION_VERSION = "0.1.0";

/** Stable workflow system identifier used on spans, metrics, and logs. */
export const WORKFLOW_SYSTEM = "temelj";

/** Stable OpenTelemetry span names emitted by `@temelj/workflow`. */
export const WORKFLOW_SPAN_NAMES = {
  childWorkflowOperation: "temelj.workflow.child_workflow.operation",
  cleanupOperation: "temelj.workflow.cleanup.operation",
  hookResume: "temelj.workflow.hook.resume",
  messageSend: "temelj.workflow.message.send",
  messageWait: "temelj.workflow.message.wait",
  runExecution: "temelj.workflow.execute",
  scheduleTick: "temelj.workflow.schedule.tick",
  scheduleRunCreate: "temelj.workflow.schedule.run.create",
  sleep: "temelj.workflow.sleep",
  stepExecution: "temelj.workflow.step",
  storageOperation: "temelj.workflow.storage.operation",
  streamOperation: "temelj.workflow.stream.operation",
  workerOperation: "temelj.workflow.worker.operation",
} as const;

/** Stable metric names emitted by `@temelj/workflow` telemetry. */
export const WORKFLOW_METRIC_NAMES = {
  cleanupDeletedRuns: "temelj.workflow.cleanup.deleted_runs",
  eventsAppended: "temelj.workflow.events.appended",
  hooksResumed: "temelj.workflow.hooks.resumed",
  hookResumeLatency: "temelj.workflow.hooks.resume_latency",
  messageWaitLatency: "temelj.workflow.messages.wait_latency",
  messagesSent: "temelj.workflow.messages.sent",
  pendingToClaimedLatency: "temelj.workflow.run.pending_to_claimed_latency",
  runDuration: "temelj.workflow.run.duration",
  runTransitions: "temelj.workflow.run.transitions",
  runs: "temelj.workflow.runs",
  retryDelay: "temelj.workflow.retry.delay",
  retryExhausted: "temelj.workflow.retry.exhausted",
  retryScheduled: "temelj.workflow.retry.scheduled",
  runWaitingToResumedLatency: "temelj.workflow.run.waiting_to_resumed_latency",
  scheduleDueToRunCreatedLatency: "temelj.workflow.schedule.due_to_run_created_latency",
  stepAttempts: "temelj.workflow.step.attempts",
  stepDuration: "temelj.workflow.step.duration",
  storageOperationDuration: "temelj.workflow.storage.operation.duration",
  storageOperationErrors: "temelj.workflow.storage.operation.errors",
  streamUpdates: "temelj.workflow.stream.updates",
  workerActiveExecutions: "temelj.workflow.worker.active_executions",
  workerClaimFailures: "temelj.workflow.worker.claim_failures",
  workerClaims: "temelj.workflow.worker.claims",
  workerHeartbeatFailures: "temelj.workflow.worker.heartbeat_failures",
  workerLeaseExtensions: "temelj.workflow.worker.lease_extensions",
  workerLeaseReleases: "temelj.workflow.worker.lease_releases",
} as const;

/** Stable workflow attribute names used by traces, metrics, and logs. */
export const WORKFLOW_ATTRIBUTES = {
  canceled: "workflow.canceled",
  childWorkflowDurationMs: "workflow.child_workflow.duration_ms",
  childWorkflowOperation: "workflow.child_workflow.operation",
  childWorkflowRunId: "workflow.child_workflow.run.id",
  childWorkflowStatus: "workflow.child_workflow.status",
  childWorkflowName: "workflow.child_workflow.name",
  childWorkflowVersion: "workflow.child_workflow.version",
  cleanupCreatedMarkers: "workflow.cleanup.created_markers",
  cleanupDeletedEvents: "workflow.cleanup.deleted_events",
  cleanupDeletedIdempotencyKeys: "workflow.cleanup.deleted_idempotency_keys",
  cleanupDeletedMarkers: "workflow.cleanup.deleted_markers",
  cleanupDeletedMessageIdempotencyKeys: "workflow.cleanup.deleted_message_idempotency_keys",
  cleanupDeletedRuns: "workflow.cleanup.deleted_runs",
  cleanupDeletedStepAttempts: "workflow.cleanup.deleted_step_attempts",
  cleanupDryRun: "workflow.cleanup.dry_run",
  cleanupMatchedRuns: "workflow.cleanup.matched_runs",
  cleanupSource: "workflow.cleanup.source",
  deadlineExceeded: "workflow.deadline.exceeded",
  errorKind: "workflow.error.kind",
  errorRetryable: "workflow.error.retryable",
  eventCategory: "workflow.event.category",
  eventKind: "workflow.event.kind",
  hookKind: "workflow.hook.kind",
  messageId: "workflow.message.id",
  messageSource: "workflow.message.source",
  namespace: "workflow.namespace",
  replay: "workflow.replay",
  retryExhausted: "workflow.retry.exhausted",
  retryReason: "workflow.retry.reason",
  runAttempt: "workflow.run.attempt",
  runId: "workflow.run.id",
  runStatus: "workflow.run.status",
  runTransition: "workflow.run.transition",
  scheduleFireAt: "workflow.schedule.fire_at",
  scheduleId: "workflow.schedule.id",
  scheduleNextAt: "workflow.schedule.next_at",
  scheduleTickedRuns: "workflow.schedule.ticked_runs",
  scheduleTickedSchedules: "workflow.schedule.ticked_schedules",
  sleepActualMs: "workflow.sleep.actual_ms",
  sleepDurationMs: "workflow.sleep.duration_ms",
  sleepUntil: "workflow.sleep.until",
  stepAttempt: "workflow.step.attempt",
  stepId: "workflow.step.id",
  stepKind: "workflow.step.kind",
  stepName: "workflow.step.name",
  stepStatus: "workflow.step.status",
  stepTimeoutAt: "workflow.step.timeout_at",
  storageBackend: "workflow.storage.backend",
  storageOperation: "workflow.storage.operation",
  storageOperationStatus: "workflow.storage.operation.status",
  streamEventKind: "workflow.stream.event.kind",
  streamId: "workflow.stream.id",
  streamIndex: "workflow.stream.index",
  streamStatus: "workflow.stream.status",
  system: "workflow.system",
  workerId: "workflow.worker.id",
  workerOperation: "workflow.worker.operation",
  workerOperationStatus: "workflow.worker.operation.status",
  workflowName: "workflow.name",
  workflowVersion: "workflow.version",
} as const;

/** OpenTelemetry semantic convention attributes used when workflow operations act like messages. */
export const WORKFLOW_MESSAGING_ATTRIBUTES = {
  destinationName: "messaging.destination.name",
  messageId: "messaging.message.id",
  operationName: "messaging.operation.name",
  operationType: "messaging.operation.type",
  system: "messaging.system",
} as const;

export function captureTelemetryContext(
  telemetry: Telemetry | undefined,
): TelemetryContext | undefined {
  try {
    return telemetry?.captureContext?.();
  } catch {
    return undefined;
  }
}

export async function withRunTelemetry<T>(
  telemetry: Telemetry | undefined,
  context: RunTelemetryContext,
  callback: () => Promise<T>,
): Promise<T> {
  if (telemetry?.withRunExecution === undefined) {
    return await callback();
  }
  return await withTelemetry(
    (wrappedCallback) => telemetry.withRunExecution!(context, wrappedCallback),
    callback,
  );
}

export async function withStepTelemetry<T>(
  telemetry: Telemetry | undefined,
  context: StepTelemetryContext,
  callback: () => Promise<T>,
): Promise<T> {
  if (telemetry?.withStepExecution === undefined) {
    return await callback();
  }
  return await withTelemetry(
    (wrappedCallback) => telemetry.withStepExecution!(context, wrappedCallback),
    callback,
  );
}

export async function withStorageTelemetry<T>(
  telemetry: Telemetry | undefined,
  context: StorageTelemetryContext,
  callback: () => Promise<T>,
): Promise<T> {
  if (telemetry?.withStorageOperation === undefined) {
    return await callback();
  }
  return await withTelemetry(
    (wrappedCallback) => telemetry.withStorageOperation!(context, wrappedCallback),
    callback,
  );
}

export function observeTelemetry<Key extends keyof ObservationEventMap>(
  telemetry: Telemetry | undefined,
  name: Key,
  payload: ObservationEventMap[Key],
): void {
  try {
    telemetry?.observe?.(name, payload);
  } catch {
    return;
  }
}

const UNSET = Symbol("workflow telemetry unset");

async function withTelemetry<T>(
  runWithTelemetry: (callback: () => Promise<T>) => Promise<T>,
  callback: () => Promise<T>,
): Promise<T> {
  let result: T | typeof UNSET = UNSET;
  let callbackError: unknown = UNSET;
  const wrappedCallback = async (): Promise<T> => {
    try {
      result = await callback();
      return result;
    } catch (error) {
      callbackError = error;
      throw error;
    }
  };

  try {
    return await runWithTelemetry(wrappedCallback);
  } catch {
    if (callbackError !== UNSET) {
      throw callbackError;
    }
    if (result !== UNSET) {
      return result;
    }
    return await callback();
  }
}
