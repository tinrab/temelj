import type { StepExecutionErrorOptions } from "../types/error.ts";
import type { RunId, StepId } from "../types/ids.ts";

import { WorkflowStepError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

export class WorkflowStepTimeoutError extends WorkflowStepError {
  public readonly runId: RunId;
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly attempt: number;
  public readonly timeoutAt: Temporal.Instant;

  constructor(options: {
    readonly runId: RunId;
    readonly stepId: StepId;
    readonly stepName: string;
    readonly attempt: number;
    readonly timeoutAt: Temporal.Instant;
  }) {
    super(
      `Workflow step timed out: ${options.stepName} for run ${options.runId} attempt ${options.attempt} at ${options.timeoutAt.toString()}`,
      {
        code: WorkflowErrorCode.STEP_TIMEOUT,
        details: {
          runId: options.runId,
          stepId: options.stepId,
          stepName: options.stepName,
          attempt: options.attempt,
          timeoutAt: options.timeoutAt.toString(),
        },
      },
    );
    this.name = "WorkflowStepTimeoutError";
    this.runId = options.runId;
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.attempt = options.attempt;
    this.timeoutAt = options.timeoutAt;
  }
}

export class WorkflowStepExecutionError extends WorkflowStepError {
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly attempt: number;

  constructor(options: StepExecutionErrorOptions) {
    super(`Workflow step failed: ${options.stepName}`, {
      code: WorkflowErrorCode.STEP_EXECUTION_FAILED,
      cause: options.cause,
      details: {
        stepId: options.stepId,
        stepName: options.stepName,
        attempt: options.attempt,
      },
    });
    this.name = "WorkflowStepExecutionError";
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.attempt = options.attempt;
  }

  static failed(this: void, options: StepExecutionErrorOptions): never {
    throw new WorkflowStepExecutionError(options);
  }
}

/** Error thrown when a step exhausts its retry policy. */
export class WorkflowStepRetryLimitError extends WorkflowStepError {
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly attempt: number;

  constructor(options: {
    readonly stepId: StepId;
    readonly stepName: string;
    readonly attempt: number;
  }) {
    super(`Workflow step retry limit exceeded: ${options.stepName}`, {
      code: WorkflowErrorCode.STEP_RETRY_LIMIT_EXCEEDED,
      details: {
        stepId: options.stepId,
        stepName: options.stepName,
        attempt: options.attempt,
      },
    });
    this.name = "WorkflowStepRetryLimitError";
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.attempt = options.attempt;
  }
}

export class WorkflowStepAttemptLimitError extends WorkflowStepError {
  public readonly runId: RunId;
  public readonly maximumAttempts: number;

  constructor(runId: RunId, maximumAttempts: number) {
    super(`Workflow run exceeded total step attempt limit: ${runId} (${maximumAttempts})`, {
      code: WorkflowErrorCode.STEP_ATTEMPT_LIMIT_EXCEEDED,
      details: { runId, maximumAttempts },
    });
    this.name = "WorkflowStepAttemptLimitError";
    this.runId = runId;
    this.maximumAttempts = maximumAttempts;
  }

  static exceeded(this: void, runId: RunId, maximumAttempts: number): never {
    throw new WorkflowStepAttemptLimitError(runId, maximumAttempts);
  }
}
