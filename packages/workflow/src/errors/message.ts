import type { RunId, WorkflowTerminalRunStatus } from "../types/run.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { MessageId } from "../types/message-id.ts";
import { StepId } from "../types/step.ts";
import { WorkflowMessageError } from "./base.ts";
import { workflowErrorRecordView } from "./record-view.ts";

/** Error thrown for message wait timeout failures. */
export class WorkflowMessageWaitTimeoutError extends WorkflowMessageError {
  public readonly runId: RunId;
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly messageId: MessageId;
  public readonly timeoutAt: Temporal.Instant;

  constructor(
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly messageId: MessageId;
      readonly timeoutAt: Temporal.Instant;
    },
    context?: Function,
  ) {
    super(
      `Workflow message wait timed out: ${options.messageId} for run ${options.runId} step ${options.stepId} at ${options.timeoutAt.toString()}`,
      {
        code: WorkflowErrorCode.MESSAGE_WAIT_TIMEOUT,
        details: {
          runId: options.runId,
          stepId: options.stepId,
          stepName: options.stepName,
          messageId: options.messageId,
          timeoutAt: options.timeoutAt.toString(),
        },
      },
      context,
    );
    this.name = "WorkflowMessageWaitTimeoutError";
    this.runId = options.runId;
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.messageId = options.messageId;
    this.timeoutAt = options.timeoutAt;
  }

  static timedOut(
    this: void,
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly messageId: MessageId;
      readonly timeoutAt: Temporal.Instant;
    },
  ): never {
    throw new WorkflowMessageWaitTimeoutError(options, WorkflowMessageWaitTimeoutError.timedOut);
  }

  static create(
    this: void,
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly messageId: MessageId;
      readonly timeoutAt: Temporal.Instant;
    },
  ): WorkflowMessageWaitTimeoutError {
    return new WorkflowMessageWaitTimeoutError(options, WorkflowMessageWaitTimeoutError.create);
  }
}

/** Error thrown for hook disposed failures. */
export class WorkflowHookDisposedError extends WorkflowMessageError {
  public readonly runId: RunId;
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly messageId: MessageId;

  constructor(
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly messageId: MessageId;
    },
    context?: Function,
  ) {
    super(
      `Workflow hook disposed: ${options.messageId} for run ${options.runId} step ${options.stepId}`,
      {
        code: WorkflowErrorCode.HOOK_DISPOSED,
        details: {
          runId: options.runId,
          stepId: options.stepId,
          stepName: options.stepName,
          messageId: options.messageId,
        },
      },
      context,
    );
    this.name = "WorkflowHookDisposedError";
    this.runId = options.runId;
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.messageId = options.messageId;
  }

  static disposed(
    this: void,
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly messageId: MessageId;
    },
  ): never {
    throw new WorkflowHookDisposedError(options, WorkflowHookDisposedError.disposed);
  }

  static create(
    this: void,
    options: {
      readonly runId: RunId;
      readonly stepId: StepId;
      readonly stepName: string;
      readonly messageId: MessageId;
    },
  ): WorkflowHookDisposedError {
    return new WorkflowHookDisposedError(options, WorkflowHookDisposedError.create);
  }

  static isDisposed(error: unknown): boolean {
    return workflowErrorRecordView(error)?.code === WorkflowErrorCode.HOOK_DISPOSED;
  }
}

/** Error thrown for message delivery failures. */
export class WorkflowMessageDeliveryError extends WorkflowMessageError {
  public readonly runId: RunId;
  public readonly status: WorkflowTerminalRunStatus;
  public readonly messageId: MessageId;

  constructor(
    options: {
      readonly runId: RunId;
      readonly status: WorkflowTerminalRunStatus;
      readonly messageId: MessageId;
    },
    context?: Function,
  ) {
    super(
      `Cannot send workflow message ${options.messageId} to ${options.status} run: ${options.runId}`,
      {
        code: WorkflowErrorCode.MESSAGE_DELIVERY_REJECTED,
        details: {
          runId: options.runId,
          status: options.status,
          messageId: options.messageId,
        },
      },
      context,
    );
    this.name = "WorkflowMessageDeliveryError";
    this.runId = options.runId;
    this.status = options.status;
    this.messageId = options.messageId;
  }

  static cannotSend(
    this: void,
    options: {
      readonly runId: RunId;
      readonly status: WorkflowTerminalRunStatus;
      readonly messageId: MessageId;
    },
  ): never {
    throw new WorkflowMessageDeliveryError(options, WorkflowMessageDeliveryError.cannotSend);
  }

  static create(
    this: void,
    options: {
      readonly runId: RunId;
      readonly status: WorkflowTerminalRunStatus;
      readonly messageId: MessageId;
    },
  ): WorkflowMessageDeliveryError {
    return new WorkflowMessageDeliveryError(options, WorkflowMessageDeliveryError.create);
  }
}

/** Error thrown for message idempotency conflict failures. */
export class WorkflowMessageIdempotencyConflictError extends WorkflowMessageError {
  public readonly runId: RunId;
  public readonly messageId: MessageId;
  public readonly idempotencyKey: string;

  constructor(
    options: {
      readonly runId: RunId;
      readonly messageId: MessageId;
      readonly idempotencyKey: string;
    },
    context?: Function,
  ) {
    super(
      `Workflow message idempotency key conflict: ${options.idempotencyKey} for message ${options.messageId} on run ${options.runId}`,
      {
        code: WorkflowErrorCode.MESSAGE_IDEMPOTENCY_CONFLICT,
        details: {
          runId: options.runId,
          messageId: options.messageId,
          idempotencyKey: options.idempotencyKey,
        },
      },
      context,
    );
    this.name = "WorkflowMessageIdempotencyConflictError";
    this.runId = options.runId;
    this.messageId = options.messageId;
    this.idempotencyKey = options.idempotencyKey;
  }

  static conflict(
    this: void,
    options: {
      readonly runId: RunId;
      readonly messageId: MessageId;
      readonly idempotencyKey: string;
    },
  ): never {
    throw new WorkflowMessageIdempotencyConflictError(
      options,
      WorkflowMessageIdempotencyConflictError.conflict,
    );
  }

  static create(
    this: void,
    options: {
      readonly runId: RunId;
      readonly messageId: MessageId;
      readonly idempotencyKey: string;
    },
  ): WorkflowMessageIdempotencyConflictError {
    return new WorkflowMessageIdempotencyConflictError(
      options,
      WorkflowMessageIdempotencyConflictError.create,
    );
  }
}
