import type { RunId, StepId } from "../types/ids.ts";
import type { RunStatus, TerminalRunStatus } from "../types/run.ts";

import { WorkflowRunError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

export class WorkflowRunNotFoundError extends WorkflowRunError {
  public readonly runId: RunId;

  constructor(runId: RunId) {
    super(`Workflow run not found: ${runId}`, {
      code: WorkflowErrorCode.RUN_NOT_FOUND,
      details: { runId },
    });
    this.name = "WorkflowRunNotFoundError";
    this.runId = runId;
  }

  static notFound(this: void, runId: RunId): never {
    throw new WorkflowRunNotFoundError(runId);
  }
}

/** Error thrown for run not found failures. */
export class WorkflowRunInvalidError extends WorkflowRunError {
  public readonly runId: RunId;

  constructor(runId: RunId, message: string) {
    super(`Workflow run '${runId}' invalid: ${message}`, {
      code: WorkflowErrorCode.RUN_INVALID,
      details: { runId },
    });
    this.name = "WorkflowRunInvalidError";
    this.runId = runId;
  }
}

export class WorkflowRunMismatchError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly expectedWorkflowName: string;
  public readonly actualWorkflowName: string;

  constructor(options: {
    readonly runId: RunId;
    readonly expectedWorkflowName: string;
    readonly actualWorkflowName: string;
  }) {
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
    throw new WorkflowRunMismatchError(options);
  }
}

export class WorkflowResultTimeoutError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly timeout: Temporal.Duration;

  constructor(runId: RunId, timeout: Temporal.Duration) {
    super(`Workflow result timed out after ${timeout.toString()}: ${runId}`, {
      code: WorkflowErrorCode.RUN_RESULT_TIMEOUT,
      details: { runId, timeout: timeout.toString() },
    });
    this.name = "WorkflowResultTimeoutError";
    this.runId = runId;
    this.timeout = timeout;
  }

  static timedOut(this: void, runId: RunId, timeout: Temporal.Duration): never {
    throw new WorkflowResultTimeoutError(runId, timeout);
  }
}

export class WorkflowRunCanceledError extends WorkflowRunError {
  public readonly runId: RunId;

  constructor(runId: RunId) {
    super(`Workflow run was canceled: ${runId}`, {
      code: WorkflowErrorCode.RUN_CANCELED,
      details: { runId },
    });
    this.name = "WorkflowRunCanceledError";
    this.runId = runId;
  }

  static canceled(this: void, runId: RunId): never {
    throw new WorkflowRunCanceledError(runId);
  }
}

export class WorkflowRunCancellationError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly status: TerminalRunStatus;

  constructor(runId: RunId, status: TerminalRunStatus) {
    super(`Cannot cancel ${status} workflow run: ${runId}`, {
      code: WorkflowErrorCode.RUN_CANCELLATION_REJECTED,
      details: { runId, status },
    });
    this.name = "WorkflowRunCancellationError";
    this.runId = runId;
    this.status = status;
  }

  static cannotCancel(this: void, runId: RunId, status: TerminalRunStatus): never {
    throw new WorkflowRunCancellationError(runId, status);
  }
}

export class WorkflowRunTransitionError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly from: RunStatus;
  public readonly to: RunStatus;

  constructor(runId: RunId, from: RunStatus, to: RunStatus) {
    super(`Invalid workflow run status transition: ${runId} ${from} -> ${to}`, {
      code: WorkflowErrorCode.RUN_TRANSITION_INVALID,
      details: { runId, from, to },
    });
    this.name = "WorkflowRunTransitionError";
    this.runId = runId;
    this.from = from;
    this.to = to;
  }
}

export class WorkflowRunParentError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly reason: string;

  constructor(runId: RunId, message: string) {
    super(`Invalid workflow run parent metadata for ${runId}: ${message}`, {
      code: WorkflowErrorCode.RUN_PARENT_INVALID,
      details: { runId, reason: message },
    });
    this.name = "WorkflowRunParentError";
    this.runId = runId;
    this.reason = message;
  }
}

export class WorkflowRunDeadlineExceededError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly deadlineAt: Temporal.Instant;

  constructor(runId: RunId, deadlineAt: Temporal.Instant) {
    super(`Workflow run deadline exceeded: ${runId} at ${deadlineAt.toString()}`, {
      code: WorkflowErrorCode.RUN_DEADLINE_EXCEEDED,
      details: { runId, deadlineAt: deadlineAt.toString() },
    });
    this.name = "WorkflowRunDeadlineExceededError";
    this.runId = runId;
    this.deadlineAt = deadlineAt;
  }
}

export class WorkflowChildWorkflowTimeoutError extends WorkflowRunError {
  public readonly runId: RunId;
  public readonly childRunId: RunId;
  public readonly stepId: StepId;
  public readonly timeoutAt: Temporal.Instant;

  constructor(options: {
    readonly runId: RunId;
    readonly childRunId: RunId;
    readonly stepId: StepId;
    readonly timeoutAt: Temporal.Instant;
  }) {
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
    );
    this.name = "WorkflowChildWorkflowTimeoutError";
    this.runId = options.runId;
    this.childRunId = options.childRunId;
    this.stepId = options.stepId;
    this.timeoutAt = options.timeoutAt;
  }
}
