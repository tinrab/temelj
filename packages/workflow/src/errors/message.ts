import type { RunId, MessageId, StepId } from "../types/ids.ts";
import type { TerminalRunStatus } from "../types/run.ts";

import { WorkflowMessageError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

export class WorkflowMessageWaitTimeoutError extends WorkflowMessageError {
  public readonly runId: RunId;
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly messageId: MessageId;
  public readonly timeoutAt: Temporal.Instant;

  constructor(options: {
    readonly runId: RunId;
    readonly stepId: StepId;
    readonly stepName: string;
    readonly messageId: MessageId;
    readonly timeoutAt: Temporal.Instant;
  }) {
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
    );
    this.name = "WorkflowMessageWaitTimeoutError";
    this.runId = options.runId;
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.messageId = options.messageId;
    this.timeoutAt = options.timeoutAt;
  }
}

export class WorkflowHookDisposedError extends WorkflowMessageError {
  public readonly runId: RunId;
  public readonly stepId: StepId;
  public readonly stepName: string;
  public readonly messageId: MessageId;

  constructor(options: {
    readonly runId: RunId;
    readonly stepId: StepId;
    readonly stepName: string;
    readonly messageId: MessageId;
  }) {
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
    );
    this.name = "WorkflowHookDisposedError";
    this.runId = options.runId;
    this.stepId = options.stepId;
    this.stepName = options.stepName;
    this.messageId = options.messageId;
  }
}

export class WorkflowMessageDeliveryError extends WorkflowMessageError {
  public readonly runId: RunId;
  public readonly status: TerminalRunStatus;
  public readonly messageId: MessageId;

  constructor(options: {
    readonly runId: RunId;
    readonly status: TerminalRunStatus;
    readonly messageId: MessageId;
  }) {
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
      readonly status: TerminalRunStatus;
      readonly messageId: MessageId;
    },
  ): never {
    throw new WorkflowMessageDeliveryError(options);
  }
}

export class WorkflowMessageIdempotencyConflictError extends WorkflowMessageError {
  public readonly runId: RunId;
  public readonly messageId: MessageId;
  public readonly idempotencyKey: string;

  constructor(options: {
    readonly runId: RunId;
    readonly messageId: MessageId;
    readonly idempotencyKey: string;
  }) {
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
    throw new WorkflowMessageIdempotencyConflictError(options);
  }
}
