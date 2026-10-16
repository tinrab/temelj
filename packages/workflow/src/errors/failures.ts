import type { WorkflowErrorOptions, RetryableErrorOptions } from "../types/error.ts";
import type { RunId, StepId } from "../types/ids.ts";

import { WorkflowError, WorkflowOptionsError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

export type { WorkflowErrorOptions, RetryableErrorOptions } from "../types/error.ts";

export class WorkflowDurationError extends WorkflowError {
  constructor(message: string) {
    super(message, { code: WorkflowErrorCode.DURATION_INVALID });
    this.name = "WorkflowDurationError";
  }
}

export class WorkflowSerializationError extends WorkflowError {
  public readonly path: string;
  public readonly reason: string;

  constructor(path: string, reason: string) {
    super(`Workflow value is not serializable at ${path}: ${reason}`, {
      code: WorkflowErrorCode.SERIALIZATION_FAILED,
      details: { path, reason },
    });
    this.name = "WorkflowSerializationError";
    this.path = path;
    this.reason = reason;
  }

  static notSerializable(this: void, path: string, reason: string): never {
    throw new WorkflowSerializationError(path, reason);
  }
}

/** Error thrown when workflow code wants to fail without retry. */
export class WorkflowNonRetryableError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions = {}) {
    super(message, { ...options, code: WorkflowErrorCode.NON_RETRYABLE_FAILURE });
    this.name = "WorkflowNonRetryableError";
  }
}

/** Error thrown when a run is intentionally marked permanently failed. */
export class WorkflowPermanentFailureError extends WorkflowError {
  public readonly runId: RunId;
  public readonly reason: string;

  constructor(options: { readonly runId: RunId; readonly reason: string }) {
    super(`Workflow run permanently failed: ${options.runId}: ${options.reason}`, {
      code: WorkflowErrorCode.PERMANENT_FAILURE,
      details: {
        runId: options.runId,
        reason: options.reason,
      },
    });
    this.name = "WorkflowPermanentFailureError";
    this.runId = options.runId;
    this.reason = options.reason;
  }
}

export class WorkflowRetryableError extends WorkflowError {
  public readonly retryAt: Temporal.Instant | undefined;
  public readonly retryDelay: Temporal.Duration | undefined;

  constructor(message: string, options: RetryableErrorOptions) {
    if (options.retryAt !== undefined && options.retryDelay !== undefined) {
      throw new WorkflowOptionsError(
        "Workflow retryable error cannot include both retryAt and retryDelay",
        { code: WorkflowErrorCode.OPTIONS_RETRYABLE_ERROR_DELAY_CONFLICT },
      );
    }

    const details = { ...options.details };

    if (options.retryAt !== undefined) details.retryAt = options.retryAt.toString();

    if (options.retryDelay !== undefined) details.retryDelay = options.retryDelay.toString();
    super(message, {
      ...options,
      code: options.code ?? WorkflowErrorCode.RETRYABLE_FAILURE,
      details,
    });
    this.name = "WorkflowRetryableError";
    this.retryAt = options.retryAt;
    this.retryDelay = options.retryDelay;
  }
}

export class WorkflowReplayDivergenceError extends WorkflowError {
  public readonly expectedStepId: StepId | undefined;
  public readonly actualStepId: StepId | undefined;

  constructor(
    message: string,
    options: {
      readonly expectedStepId?: string;
      readonly actualStepId?: string;
    },
  ) {
    const details: ReplayDivergenceDetails = {};

    if (options.expectedStepId !== undefined) details.expectedStepId = options.expectedStepId;

    if (options.actualStepId !== undefined) details.actualStepId = options.actualStepId;
    super(`Workflow replay diverged: ${message}`, {
      code: WorkflowErrorCode.REPLAY_DIVERGED,
      details,
    });
    this.name = "WorkflowReplayDivergenceError";
    this.expectedStepId = options.expectedStepId;
    this.actualStepId = options.actualStepId;
  }

  /** A divergence in one step, where the recorded and the replayed step are the same. */
  static atStep(this: void, stepId: string | undefined, message: string): never {
    throw new WorkflowReplayDivergenceError(message, {
      expectedStepId: stepId,
      actualStepId: stepId,
    });
  }

  static diverged(
    this: void,
    message: string,
    options: {
      readonly expectedStepId?: string;
      readonly actualStepId?: string;
    },
  ): never {
    throw new WorkflowReplayDivergenceError(message, options);
  }
}

type ReplayDivergenceDetails = {
  expectedStepId?: string;
  actualStepId?: string;
};
