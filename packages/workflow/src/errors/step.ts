import type { WorkflowStepExecutionErrorOptions } from "../types/error.ts";
import type { RunId } from "../types/run.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { StepId } from "../types/step.ts";
import { WorkflowStepError } from "./base.ts";

/** Error thrown for step timeout failures. */
export class WorkflowStepTimeoutError extends WorkflowStepError {
  public readonly runId: RunId;
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly attempt: number;
  public readonly timeoutAt: Temporal.Instant;

  constructor(
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly attempt: number;
      readonly timeoutAt: Temporal.Instant;
    },
    context?: Function,
  ) {
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
      context,
    );
    this.name = "WorkflowStepTimeoutError";
    this.runId = options.runId;
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.attempt = options.attempt;
    this.timeoutAt = options.timeoutAt;
  }

  static timedOut(
    this: void,
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly attempt: number;
      readonly timeoutAt: Temporal.Instant;
    },
  ): never {
    throw new WorkflowStepTimeoutError(options, WorkflowStepTimeoutError.timedOut);
  }

  static create(
    this: void,
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly attempt: number;
      readonly timeoutAt: Temporal.Instant;
    },
  ): WorkflowStepTimeoutError {
    return new WorkflowStepTimeoutError(options, WorkflowStepTimeoutError.create);
  }
}

/** Error thrown for step execution failures. */
export class WorkflowStepExecutionError extends WorkflowStepError {
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly attempt: number;

  constructor(options: WorkflowStepExecutionErrorOptions, context?: Function) {
    super(
      `Workflow step failed: ${options.stepName}`,
      {
        code: WorkflowErrorCode.STEP_EXECUTION_FAILED,
        cause: options.cause,
        details: {
          stepId: options.stepId,
          stepName: options.stepName,
          attempt: options.attempt,
        },
      },
      context,
    );
    this.name = "WorkflowStepExecutionError";
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.attempt = options.attempt;
  }

  static failed(this: void, options: WorkflowStepExecutionErrorOptions): never {
    throw new WorkflowStepExecutionError(options, WorkflowStepExecutionError.failed);
  }

  static create(
    this: void,
    options: WorkflowStepExecutionErrorOptions,
  ): WorkflowStepExecutionError {
    return new WorkflowStepExecutionError(options, WorkflowStepExecutionError.create);
  }
}

/** Error thrown when a step exhausts its retry policy. */
export class WorkflowStepRetryLimitError extends WorkflowStepError {
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly attempt: number;

  constructor(
    options: {
      readonly stepId: StepId;
      readonly stepName: string;
      readonly attempt: number;
    },
    context?: Function,
  ) {
    super(
      `Workflow step retry limit exceeded: ${options.stepName}`,
      {
        code: WorkflowErrorCode.STEP_RETRY_LIMIT_EXCEEDED,
        details: {
          stepId: options.stepId,
          stepName: options.stepName,
          attempt: options.attempt,
        },
      },
      context,
    );
    this.name = "WorkflowStepRetryLimitError";
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.attempt = options.attempt;
  }

  static exceeded(
    this: void,
    options: {
      readonly stepId: StepId;
      readonly stepName: string;
      readonly attempt: number;
    },
  ): never {
    throw new WorkflowStepRetryLimitError(options, WorkflowStepRetryLimitError.exceeded);
  }

  static create(
    this: void,
    options: {
      readonly stepId: StepId;
      readonly stepName: string;
      readonly attempt: number;
    },
  ): WorkflowStepRetryLimitError {
    return new WorkflowStepRetryLimitError(options, WorkflowStepRetryLimitError.create);
  }
}

/** Error thrown for step attempt limit failures. */
export class WorkflowStepAttemptLimitError extends WorkflowStepError {
  public readonly runId: RunId;
  public readonly maximumAttempts: number;

  constructor(runId: RunId, maximumAttempts: number, context?: Function) {
    super(
      `Workflow run exceeded total step attempt limit: ${runId} (${maximumAttempts})`,
      {
        code: WorkflowErrorCode.STEP_ATTEMPT_LIMIT_EXCEEDED,
        details: { runId, maximumAttempts },
      },
      context,
    );
    this.name = "WorkflowStepAttemptLimitError";
    this.runId = runId;
    this.maximumAttempts = maximumAttempts;
  }

  static exceeded(this: void, runId: RunId, maximumAttempts: number): never {
    throw new WorkflowStepAttemptLimitError(
      runId,
      maximumAttempts,
      WorkflowStepAttemptLimitError.exceeded,
    );
  }

  static create(this: void, runId: RunId, maximumAttempts: number): WorkflowStepAttemptLimitError {
    return new WorkflowStepAttemptLimitError(
      runId,
      maximumAttempts,
      WorkflowStepAttemptLimitError.create,
    );
  }
}
