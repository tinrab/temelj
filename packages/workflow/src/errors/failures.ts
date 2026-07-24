import type {
  WorkflowNonRetryableErrorOptions,
  WorkflowRetryableErrorOptions,
} from "../types/error.ts";
import type { RunId } from "../types/run.ts";
import type { StepId } from "../types/step.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowError, WorkflowOptionsError } from "./base.ts";
import { workflowErrorRecordView } from "./record-view.ts";

export type {
  WorkflowNonRetryableErrorOptions,
  WorkflowRetryableErrorOptions,
} from "../types/error.ts";

/** Error thrown for duration failures. */
export class WorkflowDurationError extends WorkflowError {
  constructor(message: string, context?: Function) {
    super(message, { code: WorkflowErrorCode.DURATION_INVALID }, context);
    this.name = "WorkflowDurationError";
  }

  static create(this: void, message: string): WorkflowDurationError {
    return new WorkflowDurationError(message, WorkflowDurationError.create);
  }

  static retryAtInstant(this: void, label: string): never {
    throw new WorkflowDurationError(
      `${label} retryAt must be a Temporal.Instant`,
      WorkflowDurationError.retryAtInstant,
    );
  }

  static timerSafe(this: void, label: string): never {
    throw new WorkflowDurationError(
      `${label} must be a timer-safe duration`,
      WorkflowDurationError.timerSafe,
    );
  }

  static temporalDuration(this: void, label: string): never {
    throw new WorkflowDurationError(
      `${label} must be a Temporal.Duration`,
      WorkflowDurationError.temporalDuration,
    );
  }

  static finite(this: void, label: string): never {
    throw new WorkflowDurationError(`${label} must be finite`, WorkflowDurationError.finite);
  }

  static positiveSafeInteger(this: void, label: string): never {
    throw new WorkflowDurationError(
      `${label} must be a positive safe integer`,
      WorkflowDurationError.positiveSafeInteger,
    );
  }

  static stepTimeoutPositive(this: void): never {
    throw new WorkflowDurationError(
      "Workflow step timeout must be greater than zero",
      WorkflowDurationError.stepTimeoutPositive,
    );
  }

  static signalTimeoutPositive(this: void): never {
    throw new WorkflowDurationError(
      "Workflow message timeout must be greater than zero",
      WorkflowDurationError.signalTimeoutPositive,
    );
  }

  static childPollIntervalTimerSafe(this: void): never {
    throw new WorkflowDurationError(
      "Workflow child pollInterval must be a timer-safe duration",
      WorkflowDurationError.childPollIntervalTimerSafe,
    );
  }

  static childTimeoutPositive(this: void): never {
    throw new WorkflowDurationError(
      "Workflow child timeout must be greater than zero",
      WorkflowDurationError.childTimeoutPositive,
    );
  }
}

/** Error thrown for serialization failures. */
export class WorkflowSerializationError extends WorkflowError {
  public readonly path: string;
  public readonly reason: string;

  constructor(path: string, reason: string, context?: Function) {
    super(
      `Workflow value is not serializable at ${path}: ${reason}`,
      {
        code: WorkflowErrorCode.SERIALIZATION_FAILED,
        details: { path, reason },
      },
      context,
    );
    this.name = "WorkflowSerializationError";
    this.path = path;
    this.reason = reason;
  }

  static notSerializable(this: void, path: string, reason: string): never {
    throw new WorkflowSerializationError(path, reason, WorkflowSerializationError.notSerializable);
  }

  static create(this: void, path: string, reason: string): WorkflowSerializationError {
    return new WorkflowSerializationError(path, reason, WorkflowSerializationError.create);
  }
}

/** Error thrown when workflow code wants to fail without retry. */
export class WorkflowNonRetryableError extends WorkflowError {
  constructor(message: string, options: WorkflowNonRetryableErrorOptions = {}, context?: Function) {
    super(message, { ...options, code: WorkflowErrorCode.NON_RETRYABLE_FAILURE }, context);
    this.name = "WorkflowNonRetryableError";
  }

  static failed(
    this: void,
    message: string,
    options: WorkflowNonRetryableErrorOptions = {},
  ): never {
    throw new WorkflowNonRetryableError(message, options, WorkflowNonRetryableError.failed);
  }

  static create(
    this: void,
    message: string,
    options: WorkflowNonRetryableErrorOptions = {},
  ): WorkflowNonRetryableError {
    return new WorkflowNonRetryableError(message, options, WorkflowNonRetryableError.create);
  }
}

/** Error thrown when a run is intentionally marked permanently failed. */
export class WorkflowPermanentFailureError extends WorkflowError {
  public readonly runId: RunId;
  public readonly reason: string;

  constructor(options: { readonly runId: RunId; readonly reason: string }, context?: Function) {
    super(
      `Workflow run permanently failed: ${options.runId}: ${options.reason}`,
      {
        code: WorkflowErrorCode.PERMANENT_FAILURE,
        details: {
          runId: options.runId,
          reason: options.reason,
        },
      },
      context,
    );
    this.name = "WorkflowPermanentFailureError";
    this.runId = options.runId;
    this.reason = options.reason;
  }

  static failed(this: void, options: { readonly runId: RunId; readonly reason: string }): never {
    throw new WorkflowPermanentFailureError(options, WorkflowPermanentFailureError.failed);
  }

  static create(
    this: void,
    options: { readonly runId: RunId; readonly reason: string },
  ): WorkflowPermanentFailureError {
    return new WorkflowPermanentFailureError(options, WorkflowPermanentFailureError.create);
  }
}

/** Error thrown for retryable failures. */
export class WorkflowRetryableError extends WorkflowError {
  public readonly retryAt: Temporal.Instant | undefined;
  public readonly retryDelay: Temporal.Duration | undefined;

  constructor(message: string, options: WorkflowRetryableErrorOptions, context?: Function) {
    if (options.retryAt !== undefined && options.retryDelay !== undefined) {
      WorkflowOptionsError.retryableErrorDelayConflict();
    }
    super(
      message,
      {
        ...options,
        code: options.code ?? WorkflowErrorCode.RETRYABLE_FAILURE,
        details: {
          ...options.details,
          ...(options.retryAt === undefined ? {} : { retryAt: options.retryAt.toString() }),
          ...(options.retryDelay === undefined
            ? {}
            : { retryDelay: options.retryDelay.toString() }),
        },
      },
      context,
    );
    this.name = "WorkflowRetryableError";
    this.retryAt = options.retryAt;
    this.retryDelay = options.retryDelay;
  }

  static lockAlreadyHeld(this: void, key: string, options: WorkflowRetryableErrorOptions): never {
    throw new WorkflowRetryableError(
      `Workflow lock is already held: ${key}`,
      {
        ...options,
        code: WorkflowErrorCode.LOCK_ALREADY_HELD,
        details: { ...options.details, key },
      },
      WorkflowRetryableError.lockAlreadyHeld,
    );
  }

  static isLockAlreadyHeld(error: unknown, key?: string): boolean {
    const record = workflowErrorRecordView(error);
    return (
      record?.code === WorkflowErrorCode.LOCK_ALREADY_HELD &&
      (key === undefined || record.details?.key === key)
    );
  }

  static failed(this: void, message: string, options: WorkflowRetryableErrorOptions): never {
    throw new WorkflowRetryableError(message, options, WorkflowRetryableError.failed);
  }

  static create(
    this: void,
    message: string,
    options: WorkflowRetryableErrorOptions,
  ): WorkflowRetryableError {
    return new WorkflowRetryableError(message, options, WorkflowRetryableError.create);
  }
}

/** Error thrown for replay divergence failures. */
export class WorkflowReplayDivergenceError extends WorkflowError {
  public readonly expectedStepId: StepId | undefined;
  public readonly actualStepId: StepId | undefined;

  constructor(
    message: string,
    options: {
      readonly expectedStepId?: string;
      readonly actualStepId?: string;
    },
    context?: Function,
  ) {
    super(
      `Workflow replay diverged: ${message}`,
      {
        code: WorkflowErrorCode.REPLAY_DIVERGED,
        details: {
          ...(options.expectedStepId === undefined
            ? {}
            : { expectedStepId: options.expectedStepId }),
          ...(options.actualStepId === undefined ? {} : { actualStepId: options.actualStepId }),
        },
      },
      context,
    );
    this.name = "WorkflowReplayDivergenceError";
    this.expectedStepId = options.expectedStepId;
    this.actualStepId = options.actualStepId;
  }

  static diverged(
    this: void,
    message: string,
    options: {
      readonly expectedStepId?: string;
      readonly actualStepId?: string;
    },
  ): never {
    throw new WorkflowReplayDivergenceError(
      message,
      options,
      WorkflowReplayDivergenceError.diverged,
    );
  }

  static create(
    this: void,
    message: string,
    options: {
      readonly expectedStepId?: string;
      readonly actualStepId?: string;
    },
  ): WorkflowReplayDivergenceError {
    return new WorkflowReplayDivergenceError(
      message,
      options,
      WorkflowReplayDivergenceError.create,
    );
  }
}
