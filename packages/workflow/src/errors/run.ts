import type { RunId, WorkflowRunStatus, WorkflowTerminalRunStatus } from "../types/run.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { StepId } from "../types/step.ts";
import { WorkflowRunError } from "./base.ts";

/** Error thrown for run not found failures. */
export class WorkflowRunNotFoundError extends WorkflowRunError {
  public readonly runId: RunId;

  constructor(runId: RunId, context?: Function) {
    super(
      `Workflow run not found: ${runId}`,
      { code: WorkflowErrorCode.RUN_NOT_FOUND, details: { runId } },
      context,
    );
    this.name = "WorkflowRunNotFoundError";
    this.runId = runId;
  }

  static notFound(this: void, runId: RunId): never {
    throw new WorkflowRunNotFoundError(runId, WorkflowRunNotFoundError.notFound);
  }

  static create(this: void, runId: RunId): WorkflowRunNotFoundError {
    return new WorkflowRunNotFoundError(runId, WorkflowRunNotFoundError.create);
  }
}

/** Error thrown for run not found failures. */
export class WorkflowRunInvalidError extends WorkflowRunError {
  public readonly runId: RunId;

  constructor(runId: RunId, message: string, context?: Function) {
    super(
      `Workflow run '${runId}' invalid: ${message}`,
      { code: WorkflowErrorCode.RUN_INVALID, details: { runId } },
      context,
    );
    this.name = "WorkflowRunInvalidError";
    this.runId = runId;
  }

  static invalid(this: void, runId: RunId, message: string): never {
    throw new WorkflowRunInvalidError(runId, message, WorkflowRunInvalidError.invalid);
  }

  static create(this: void, runId: RunId, message: string): WorkflowRunInvalidError {
    return new WorkflowRunInvalidError(runId, message, WorkflowRunInvalidError.create);
  }
}

/** Error thrown for run mismatch failures. */
export class WorkflowRunMismatchError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly expectedWorkflowName: string;
  public readonly actualWorkflowName: string;

  constructor(
    options: {
      readonly runId: RunId;
      readonly expectedWorkflowName: string;
      readonly actualWorkflowName: string;
    },
    context?: Function,
  ) {
    super(
      `Workflow run ${options.runId} belongs to ${options.actualWorkflowName}, not ${options.expectedWorkflowName}`,
      {
        code: WorkflowErrorCode.RUN_WORKFLOW_MISMATCH,
        details: {
          runId: options.runId,
          expectedWorkflowName: options.expectedWorkflowName,
          actualWorkflowName: options.actualWorkflowName,
        },
      },
      context,
    );
    this.name = "WorkflowRunMismatchError";
    this.runId = options.runId;
    this.expectedWorkflowName = options.expectedWorkflowName;
    this.actualWorkflowName = options.actualWorkflowName;
  }

  static mismatch(
    this: void,
    options: {
      readonly runId: RunId;
      readonly expectedWorkflowName: string;
      readonly actualWorkflowName: string;
    },
  ): never {
    throw new WorkflowRunMismatchError(options, WorkflowRunMismatchError.mismatch);
  }

  static create(
    this: void,
    options: {
      readonly runId: RunId;
      readonly expectedWorkflowName: string;
      readonly actualWorkflowName: string;
    },
  ): WorkflowRunMismatchError {
    return new WorkflowRunMismatchError(options, WorkflowRunMismatchError.create);
  }
}

/** Error thrown for result timeout failures. */
export class WorkflowResultTimeoutError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly timeout: Temporal.Duration;

  constructor(runId: RunId, timeout: Temporal.Duration, context?: Function) {
    super(
      `Workflow result timed out after ${timeout.toString()}: ${runId}`,
      {
        code: WorkflowErrorCode.RUN_RESULT_TIMEOUT,
        details: { runId, timeout: timeout.toString() },
      },
      context,
    );
    this.name = "WorkflowResultTimeoutError";
    this.runId = runId;
    this.timeout = timeout;
  }

  static timedOut(this: void, runId: RunId, timeout: Temporal.Duration): never {
    throw new WorkflowResultTimeoutError(runId, timeout, WorkflowResultTimeoutError.timedOut);
  }

  static create(this: void, runId: RunId, timeout: Temporal.Duration): WorkflowResultTimeoutError {
    return new WorkflowResultTimeoutError(runId, timeout, WorkflowResultTimeoutError.create);
  }
}

/** Error thrown for run canceled failures. */
export class WorkflowRunCanceledError extends WorkflowRunError {
  public readonly runId: RunId;

  constructor(runId: RunId, context?: Function) {
    super(
      `Workflow run was canceled: ${runId}`,
      { code: WorkflowErrorCode.RUN_CANCELED, details: { runId } },
      context,
    );
    this.name = "WorkflowRunCanceledError";
    this.runId = runId;
  }

  static canceled(this: void, runId: RunId): never {
    throw new WorkflowRunCanceledError(runId, WorkflowRunCanceledError.canceled);
  }

  static create(this: void, runId: RunId): WorkflowRunCanceledError {
    return new WorkflowRunCanceledError(runId, WorkflowRunCanceledError.create);
  }
}

/** Error thrown for run cancellation failures. */
export class WorkflowRunCancellationError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly status: WorkflowTerminalRunStatus;

  constructor(runId: RunId, status: WorkflowTerminalRunStatus, context?: Function) {
    super(
      `Cannot cancel ${status} workflow run: ${runId}`,
      {
        code: WorkflowErrorCode.RUN_CANCELLATION_REJECTED,
        details: { runId, status },
      },
      context,
    );
    this.name = "WorkflowRunCancellationError";
    this.runId = runId;
    this.status = status;
  }

  static cannotCancel(this: void, runId: RunId, status: WorkflowTerminalRunStatus): never {
    throw new WorkflowRunCancellationError(
      runId,
      status,
      WorkflowRunCancellationError.cannotCancel,
    );
  }

  static create(
    this: void,
    runId: RunId,
    status: WorkflowTerminalRunStatus,
  ): WorkflowRunCancellationError {
    return new WorkflowRunCancellationError(runId, status, WorkflowRunCancellationError.create);
  }
}

/** Error thrown for run transition failures. */
export class WorkflowRunTransitionError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly from: WorkflowRunStatus;
  public readonly to: WorkflowRunStatus;

  constructor(runId: RunId, from: WorkflowRunStatus, to: WorkflowRunStatus, context?: Function) {
    super(
      `Invalid workflow run status transition: ${runId} ${from} -> ${to}`,
      {
        code: WorkflowErrorCode.RUN_TRANSITION_INVALID,
        details: { runId, from, to },
      },
      context,
    );
    this.name = "WorkflowRunTransitionError";
    this.runId = runId;
    this.from = from;
    this.to = to;
  }

  static invalidTransition(
    this: void,
    runId: RunId,
    from: WorkflowRunStatus,
    to: WorkflowRunStatus,
  ): never {
    throw new WorkflowRunTransitionError(
      runId,
      from,
      to,
      WorkflowRunTransitionError.invalidTransition,
    );
  }

  static create(
    this: void,
    runId: RunId,
    from: WorkflowRunStatus,
    to: WorkflowRunStatus,
  ): WorkflowRunTransitionError {
    return new WorkflowRunTransitionError(runId, from, to, WorkflowRunTransitionError.create);
  }
}

/** Error thrown for run parent failures. */
export class WorkflowRunParentError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly reason: string;

  constructor(runId: RunId, message: string, context?: Function) {
    super(
      `Invalid workflow run parent metadata for ${runId}: ${message}`,
      {
        code: WorkflowErrorCode.RUN_PARENT_INVALID,
        details: { runId, reason: message },
      },
      context,
    );
    this.name = "WorkflowRunParentError";
    this.runId = runId;
    this.reason = message;
  }

  static invalidParent(this: void, runId: RunId, message: string): never {
    throw new WorkflowRunParentError(runId, message, WorkflowRunParentError.invalidParent);
  }

  static create(this: void, runId: RunId, message: string): WorkflowRunParentError {
    return new WorkflowRunParentError(runId, message, WorkflowRunParentError.create);
  }
}

/** Error thrown for run deadline exceeded failures. */
export class WorkflowRunDeadlineExceededError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly deadlineAt: Temporal.Instant;

  constructor(runId: RunId, deadlineAt: Temporal.Instant, context?: Function) {
    super(
      `Workflow run deadline exceeded: ${runId} at ${deadlineAt.toString()}`,
      {
        code: WorkflowErrorCode.RUN_DEADLINE_EXCEEDED,
        details: { runId, deadlineAt: deadlineAt.toString() },
      },
      context,
    );
    this.name = "WorkflowRunDeadlineExceededError";
    this.runId = runId;
    this.deadlineAt = deadlineAt;
  }

  static deadlineExceeded(this: void, runId: RunId, deadlineAt: Temporal.Instant): never {
    throw new WorkflowRunDeadlineExceededError(
      runId,
      deadlineAt,
      WorkflowRunDeadlineExceededError.deadlineExceeded,
    );
  }

  static create(
    this: void,
    runId: RunId,
    deadlineAt: Temporal.Instant,
  ): WorkflowRunDeadlineExceededError {
    return new WorkflowRunDeadlineExceededError(
      runId,
      deadlineAt,
      WorkflowRunDeadlineExceededError.create,
    );
  }
}

/** Error thrown for child workflow timeout failures. */
export class WorkflowChildWorkflowTimeoutError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly childRunId: RunId;
  public readonly stepId: StepId;
  public readonly timeoutAt: Temporal.Instant;

  constructor(
    options: {
      readonly runId: RunId;
      readonly childRunId: RunId;
      readonly stepId: StepId;
      readonly timeoutAt: Temporal.Instant;
    },
    context?: Function,
  ) {
    super(
      `Child workflow timed out: ${options.childRunId} for parent ${options.runId} step ${options.stepId} at ${options.timeoutAt.toString()}`,
      {
        code: WorkflowErrorCode.CHILD_WORKFLOW_TIMEOUT,
        details: {
          runId: options.runId,
          childRunId: options.childRunId,
          stepId: options.stepId,
          timeoutAt: options.timeoutAt.toString(),
        },
      },
      context,
    );
    this.name = "WorkflowChildWorkflowTimeoutError";
    this.runId = options.runId;
    this.childRunId = options.childRunId;
    this.stepId = options.stepId;
    this.timeoutAt = options.timeoutAt;
  }

  static timedOut(
    this: void,
    options: {
      readonly runId: RunId;
      readonly childRunId: RunId;
      readonly stepId: StepId;
      readonly timeoutAt: Temporal.Instant;
    },
  ): never {
    throw new WorkflowChildWorkflowTimeoutError(
      options,
      WorkflowChildWorkflowTimeoutError.timedOut,
    );
  }

  static create(
    this: void,
    options: {
      readonly runId: RunId;
      readonly childRunId: RunId;
      readonly stepId: StepId;
      readonly timeoutAt: Temporal.Instant;
    },
  ): WorkflowChildWorkflowTimeoutError {
    return new WorkflowChildWorkflowTimeoutError(options, WorkflowChildWorkflowTimeoutError.create);
  }
}
