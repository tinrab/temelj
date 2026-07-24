import type {
  WorkflowErrorCode as WorkflowErrorCodeType,
  WorkflowErrorDetails,
  WorkflowErrorOptions,
} from "../types/error.ts";
import type { EventKind } from "../types/events.ts";
import type { RunId, WorkflowTerminalRunStatus } from "../types/run.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { StepId } from "../types/step.ts";

export type { WorkflowErrorOptions } from "../types/error.ts";

/** Base error for workflow failures that carry optional structured details. */
export class WorkflowError extends Error {
  public readonly code: WorkflowErrorCodeType;
  public readonly cause: unknown;
  public readonly details: WorkflowErrorDetails | undefined;

  constructor(message: string, options: WorkflowErrorOptions = {}, context?: Function) {
    super(message);
    this.name = "WorkflowError";
    this.code = options.code ?? WorkflowErrorCode.ERROR;
    this.cause = options.cause;
    this.details = options.details;

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static fromMessage(
    this: void,
    message: string,
    options: WorkflowErrorOptions = {},
  ): WorkflowError {
    return new WorkflowError(message, options, WorkflowError.fromMessage);
  }
}
/** Error thrown for options failures. */
export class WorkflowOptionsError extends WorkflowError {
  constructor(message: string, context?: Function, options: WorkflowErrorOptions = {}) {
    super(
      message,
      { ...options, code: options.code ?? WorkflowErrorCode.OPTIONS_INVALID },
      context,
    );
    this.name = "WorkflowOptionsError";
  }

  static create(this: void, message: string): WorkflowOptionsError {
    return new WorkflowOptionsError(message, WorkflowOptionsError.create);
  }

  static object(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must be an object`, WorkflowOptionsError.object, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_OBJECT,
      details: { label },
    });
  }

  static array(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must be an array`, WorkflowOptionsError.array, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_ARRAY,
      details: { label },
    });
  }

  static function(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must be a function`, WorkflowOptionsError.function, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_FUNCTION,
      details: { label },
    });
  }

  static string(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must be a string`, WorkflowOptionsError.string, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_STRING,
      details: { label },
    });
  }

  static nonEmpty(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must not be empty`, WorkflowOptionsError.nonEmpty, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_NON_EMPTY,
      details: { label },
    });
  }

  static nonBlank(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must not be blank`, WorkflowOptionsError.nonBlank, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_NON_BLANK,
      details: { label },
    });
  }

  static number(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must be a number`, WorkflowOptionsError.number, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_NUMBER,
      details: { label },
    });
  }

  static boolean(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must be a boolean`, WorkflowOptionsError.boolean, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_BOOLEAN,
      details: { label },
    });
  }

  static required(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} is required`, WorkflowOptionsError.required, {
      code: WorkflowErrorCode.OPTIONS_REQUIRED,
      details: { label },
    });
  }

  static positiveSafeInteger(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} must be a positive safe integer`,
      WorkflowOptionsError.positiveSafeInteger,
      {
        code: WorkflowErrorCode.OPTIONS_EXPECTED_POSITIVE_SAFE_INTEGER,
        details: { label },
      },
    );
  }

  static nonNegativeSafeInteger(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} must be a non-negative safe integer`,
      WorkflowOptionsError.nonNegativeSafeInteger,
      {
        code: WorkflowErrorCode.OPTIONS_EXPECTED_NON_NEGATIVE_SAFE_INTEGER,
        details: { label },
      },
    );
  }

  static positiveDuration(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} must be greater than zero`,
      WorkflowOptionsError.positiveDuration,
      {
        code: WorkflowErrorCode.OPTIONS_EXPECTED_POSITIVE_DURATION,
        details: { label },
      },
    );
  }

  static nonNegativeDuration(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} must be non-negative`,
      WorkflowOptionsError.nonNegativeDuration,
      {
        code: WorkflowErrorCode.OPTIONS_EXPECTED_NON_NEGATIVE_DURATION,
        details: { label },
      },
    );
  }

  static safeDuration(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} must be a timer-safe duration`,
      WorkflowOptionsError.safeDuration,
      {
        code: WorkflowErrorCode.OPTIONS_EXPECTED_TIMER_SAFE_DURATION,
        details: { label },
      },
    );
  }

  static positiveSafeIntegerDuration(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} must be a positive safe integer duration`,
      WorkflowOptionsError.positiveSafeIntegerDuration,
      {
        code: WorkflowErrorCode.OPTIONS_EXPECTED_POSITIVE_SAFE_INTEGER_DURATION,
        details: { label },
      },
    );
  }

  static temporalInstant(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} must be a Temporal.Instant`,
      WorkflowOptionsError.temporalInstant,
      {
        code: WorkflowErrorCode.OPTIONS_EXPECTED_TEMPORAL_INSTANT,
        details: { label },
      },
    );
  }

  static abortSignal(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} must be an AbortSignal`,
      WorkflowOptionsError.abortSignal,
      {
        code: WorkflowErrorCode.OPTIONS_EXPECTED_ABORT_SIGNAL,
        details: { label },
      },
    );
  }

  static childCancellationPolicy(this: void): never {
    throw new WorkflowOptionsError(
      "Workflow child cancellation policy must be cascade or detach",
      WorkflowOptionsError.childCancellationPolicy,
      { code: WorkflowErrorCode.OPTIONS_CHILD_CANCELLATION_POLICY_INVALID },
    );
  }

  static cursorInvalid(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} cursor is invalid`,
      WorkflowOptionsError.cursorInvalid,
      { code: WorkflowErrorCode.OPTIONS_CURSOR_INVALID, details: { label } },
    );
  }

  static retryMaximumIntervalTooSmall(this: void, label: string): never {
    throw new WorkflowOptionsError(
      `${label} maximumInterval must be at least initialInterval`,
      WorkflowOptionsError.retryMaximumIntervalTooSmall,
      {
        code: WorkflowErrorCode.OPTIONS_RETRY_MAXIMUM_INTERVAL_TOO_SMALL,
        details: { label },
      },
    );
  }

  static retryableErrorDelayConflict(this: void): never {
    throw new WorkflowOptionsError(
      "Workflow retryable error cannot include both retryAt and retryDelay",
      WorkflowOptionsError.retryableErrorDelayConflict,
      { code: WorkflowErrorCode.OPTIONS_RETRYABLE_ERROR_DELAY_CONFLICT },
    );
  }

  static engineStoreAndStorageConflict(this: void): never {
    throw new WorkflowOptionsError(
      "Workflow engine options cannot include both store and storage",
      WorkflowOptionsError.engineStoreAndStorageConflict,
      { code: WorkflowErrorCode.OPTIONS_ENGINE_STORE_STORAGE_CONFLICT },
    );
  }

  static missingImplementationRetryAttemptPositiveSafeInteger(this: void): never {
    throw new WorkflowOptionsError(
      "Workflow missing implementation retry delay attempt must be a positive safe integer",
      WorkflowOptionsError.missingImplementationRetryAttemptPositiveSafeInteger,
      { code: WorkflowErrorCode.OPTIONS_MISSING_IMPLEMENTATION_RETRY_ATTEMPT_INVALID },
    );
  }
}
/** Error thrown for state failures. */
export class WorkflowStateError extends WorkflowError {
  constructor(message: string, context?: Function, options: WorkflowErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.STATE_INVALID }, context);
    this.name = "WorkflowStateError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static create(this: void, message: string): WorkflowStateError {
    return new WorkflowStateError(message, WorkflowStateError.create);
  }

  static runNamespaceMismatch(this: void, actual: string, expected: string): never {
    throw new WorkflowStateError(
      `Workflow run namespace mismatch: ${actual} !== ${expected}`,
      WorkflowStateError.runNamespaceMismatch,
      {
        code: WorkflowErrorCode.STATE_RUN_NAMESPACE_MISMATCH,
        details: { actual, expected },
      },
    );
  }

  static runIdMismatch(this: void, actual: string, expected: string): never {
    throw new WorkflowStateError(
      `Workflow store runId mismatch: ${actual} !== ${expected}`,
      WorkflowStateError.runIdMismatch,
      { code: WorkflowErrorCode.STATE_RUN_ID_MISMATCH, details: { actual, expected } },
    );
  }

  static runIdAlreadyExists(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow run already exists: ${runId}`,
      WorkflowStateError.runIdAlreadyExists,
      { code: WorkflowErrorCode.STATE_RUN_ALREADY_EXISTS, details: { runId } },
    );
  }

  static eventHistoryAlreadyExists(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow event history already exists: ${runId}`,
      WorkflowStateError.eventHistoryAlreadyExists,
      { code: WorkflowErrorCode.STATE_EVENT_HISTORY_ALREADY_EXISTS, details: { runId } },
    );
  }

  static eventNotTerminalStep(this: void, kind: EventKind): never {
    throw new WorkflowStateError(
      `Workflow event is not a terminal step event: ${kind}`,
      WorkflowStateError.eventNotTerminalStep,
      { code: WorkflowErrorCode.STATE_EVENT_NOT_TERMINAL_STEP, details: { kind } },
    );
  }

  static unsupportedRecordedStepEventType(this: void, kind: EventKind): never {
    throw new WorkflowStateError(
      `Workflow recorded step event type is not supported: ${kind}`,
      WorkflowStateError.unsupportedRecordedStepEventType,
      { code: WorkflowErrorCode.STATE_RECORDED_STEP_EVENT_UNSUPPORTED, details: { kind } },
    );
  }

  static stepAttemptFieldMismatch(this: void, stepId: StepId, field: string): never {
    throw new WorkflowStateError(
      `Workflow step attempt ${stepId} ${field} must match started attempt`,
      WorkflowStateError.stepAttemptFieldMismatch,
      {
        code: WorkflowErrorCode.STATE_STEP_ATTEMPT_FIELD_MISMATCH,
        details: { stepId, field },
      },
    );
  }

  static failedRunMissingError(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Failed workflow run is missing error: ${runId}`,
      WorkflowStateError.failedRunMissingError,
      { code: WorkflowErrorCode.STATE_FAILED_RUN_MISSING_ERROR, details: { runId } },
    );
  }

  static runNotClaimable(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow run is not claimable: ${runId}`,
      WorkflowStateError.runNotClaimable,
      { code: WorkflowErrorCode.STATE_RUN_NOT_CLAIMABLE, details: { runId } },
    );
  }

  static workerStoppedBeforeRun(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow worker stopped before executing run: ${runId}`,
      WorkflowStateError.workerStoppedBeforeRun,
      { code: WorkflowErrorCode.STATE_WORKER_STOPPED_BEFORE_RUN, details: { runId } },
    );
  }

  static storeRunIdInvalid(this: void): never {
    throw new WorkflowStateError(
      "Workflow store runId is invalid: Expected a non-blank string",
      WorkflowStateError.storeRunIdInvalid,
      { code: WorkflowErrorCode.STATE_STORE_RUN_ID_INVALID },
    );
  }

  static invalid(this: void, label: string, issues: string): never {
    throw new WorkflowStateError(`${label} is invalid: ${issues}`, WorkflowStateError.invalid, {
      code: WorkflowErrorCode.STATE_INVALID,
      details: { label, issues },
    });
  }

  static idempotencyKeyClaimedWithoutRun(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow idempotency key was claimed without a run: ${runId}`,
      WorkflowStateError.idempotencyKeyClaimedWithoutRun,
      {
        code: WorkflowErrorCode.STATE_IDEMPOTENCY_KEY_CLAIMED_WITHOUT_RUN,
        details: { runId },
      },
    );
  }

  static runMissingIdempotencyKey(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow run does not have an idempotency key: ${runId}`,
      WorkflowStateError.runMissingIdempotencyKey,
      { code: WorkflowErrorCode.STATE_RUN_MISSING_IDEMPOTENCY_KEY, details: { runId } },
    );
  }

  static failedRunMetadataUpdate(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Failed to update workflow run metadata for run ${runId}`,
      WorkflowStateError.failedRunMetadataUpdate,
      { code: WorkflowErrorCode.STATE_RUN_METADATA_UPDATE_FAILED, details: { runId } },
    );
  }

  static failedRunAttributesUpdate(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Failed to update workflow run attributes for run ${runId}`,
      WorkflowStateError.failedRunAttributesUpdate,
      { code: WorkflowErrorCode.STATE_RUN_ATTRIBUTES_UPDATE_FAILED, details: { runId } },
    );
  }

  static runCannotBeRescheduled(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow run cannot be rescheduled unless pending or waiting: ${runId}`,
      WorkflowStateError.runCannotBeRescheduled,
      { code: WorkflowErrorCode.STATE_RUN_CANNOT_BE_RESCHEDULED, details: { runId } },
    );
  }

  static failedRunReschedule(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Failed to reschedule workflow run ${runId}`,
      WorkflowStateError.failedRunReschedule,
      { code: WorkflowErrorCode.STATE_RUN_RESCHEDULE_FAILED, details: { runId } },
    );
  }

  static staleLeaseReleaseRequiresRunning(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow run stale lease cannot be released unless running: ${runId}`,
      WorkflowStateError.staleLeaseReleaseRequiresRunning,
      {
        code: WorkflowErrorCode.STATE_STALE_LEASE_RELEASE_REQUIRES_RUNNING,
        details: { runId },
      },
    );
  }

  static runLeaseStillActive(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow run lease is still active: ${runId}`,
      WorkflowStateError.runLeaseStillActive,
      { code: WorkflowErrorCode.STATE_RUN_LEASE_STILL_ACTIVE, details: { runId } },
    );
  }

  static failedStaleRunLeaseRelease(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Failed to release stale workflow run lease ${runId}`,
      WorkflowStateError.failedStaleRunLeaseRelease,
      { code: WorkflowErrorCode.STATE_STALE_RUN_LEASE_RELEASE_FAILED, details: { runId } },
    );
  }

  static runRetryRequiresFailed(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow run cannot be retried unless failed: ${runId}`,
      WorkflowStateError.runRetryRequiresFailed,
      { code: WorkflowErrorCode.STATE_RUN_RETRY_REQUIRES_FAILED, details: { runId } },
    );
  }

  static runRetryRequiresForceAfterPermanentFailure(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow run cannot be retried after permanent failure without force: ${runId}`,
      WorkflowStateError.runRetryRequiresForceAfterPermanentFailure,
      {
        code: WorkflowErrorCode.STATE_RUN_RETRY_REQUIRES_FORCE_AFTER_PERMANENT_FAILURE,
        details: { runId },
      },
    );
  }

  static failedRunRetryRequiresForce(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow failed run retry requires force when no retry metadata exists: ${runId}`,
      WorkflowStateError.failedRunRetryRequiresForce,
      {
        code: WorkflowErrorCode.STATE_FAILED_RUN_RETRY_REQUIRES_FORCE,
        details: { runId },
      },
    );
  }

  static failedRunRetry(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Failed to retry workflow run ${runId}`,
      WorkflowStateError.failedRunRetry,
      { code: WorkflowErrorCode.STATE_RUN_RETRY_FAILED, details: { runId } },
    );
  }

  static failedPermanentRunFailure(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Failed to mark workflow run permanently failed ${runId}`,
      WorkflowStateError.failedPermanentRunFailure,
      { code: WorkflowErrorCode.STATE_PERMANENT_RUN_FAILURE_FAILED, details: { runId } },
    );
  }

  static permanentFailureInvalidStatus(
    this: void,
    runId: RunId,
    status: WorkflowTerminalRunStatus,
  ): never {
    throw new WorkflowStateError(
      `Workflow run cannot be marked permanently failed from ${status}: ${runId}`,
      WorkflowStateError.permanentFailureInvalidStatus,
      {
        code: WorkflowErrorCode.STATE_PERMANENT_FAILURE_STATUS_INVALID,
        details: { runId, status },
      },
    );
  }

  static failedMessageAppend(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Failed to append workflow message for run ${runId}`,
      WorkflowStateError.failedMessageAppend,
      { code: WorkflowErrorCode.STATE_MESSAGE_APPEND_FAILED, details: { runId } },
    );
  }

  static cleanupSelectedNonTerminalRun(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow cleanup selected non-terminal run: ${runId}`,
      WorkflowStateError.cleanupSelectedNonTerminalRun,
      {
        code: WorkflowErrorCode.STATE_CLEANUP_SELECTED_NON_TERMINAL_RUN,
        details: { runId },
      },
    );
  }

  static cleanupRunMissingFinishedAt(this: void, runId: RunId): never {
    throw new WorkflowStateError(
      `Workflow cleanup run is missing finishedAt: ${runId}`,
      WorkflowStateError.cleanupRunMissingFinishedAt,
      { code: WorkflowErrorCode.STATE_CLEANUP_RUN_MISSING_FINISHED_AT, details: { runId } },
    );
  }

  static failedWorkflowEventAppend(this: void, runId: RunId, attempts: number): never {
    throw new WorkflowStateError(
      `Failed to append workflow event for run ${runId} after ${attempts} attempts`,
      WorkflowStateError.failedWorkflowEventAppend,
      {
        code: WorkflowErrorCode.STATE_WORKFLOW_EVENT_APPEND_FAILED,
        details: { runId, attempts },
      },
    );
  }

  static failedStepAttemptMaterialization(this: void, runId: RunId, attempts: number): never {
    throw new WorkflowStateError(
      `Failed to materialize workflow step attempt for run ${runId} after ${attempts} attempts`,
      WorkflowStateError.failedStepAttemptMaterialization,
      {
        code: WorkflowErrorCode.STATE_STEP_ATTEMPT_MATERIALIZATION_FAILED,
        details: { runId, attempts },
      },
    );
  }

  static appendProjectionPipelineMissing(this: void): never {
    throw new WorkflowStateError(
      "Cannot finalize workflow event append without an append projection pipeline.",
      WorkflowStateError.appendProjectionPipelineMissing,
      { code: WorkflowErrorCode.STATE_APPEND_PROJECTION_PIPELINE_MISSING },
    );
  }
}

/** Error thrown for run failures. */
export class WorkflowRunError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions, context?: Function) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.RUN_ERROR }, context);
    this.name = "WorkflowRunError";
  }

  static fromMessage(this: void, message: string, options: WorkflowErrorOptions): WorkflowRunError {
    return new WorkflowRunError(message, options, WorkflowRunError.fromMessage);
  }
}

/** Error thrown for step failures. */
export class WorkflowStepError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions, context?: Function) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.STEP_ERROR }, context);
    this.name = "WorkflowStepError";
  }

  static fromMessage(
    this: void,
    message: string,
    options: WorkflowErrorOptions,
  ): WorkflowStepError {
    return new WorkflowStepError(message, options, WorkflowStepError.fromMessage);
  }
}

/** Error thrown for message failures. */
export class WorkflowMessageError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions, context?: Function) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.MESSAGE_ERROR }, context);
    this.name = "WorkflowMessageError";
  }

  static fromMessage(
    this: void,
    message: string,
    options: WorkflowErrorOptions,
  ): WorkflowMessageError {
    return new WorkflowMessageError(message, options, WorkflowMessageError.fromMessage);
  }
}
