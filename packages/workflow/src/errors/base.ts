import type { ErrorDetails, WorkflowErrorOptions } from "../types/error.ts";
import type { EventKind } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";

import { WorkflowErrorCode } from "./codes.ts";

export type { WorkflowErrorOptions } from "../types/error.ts";

/** Base error for workflow failures that carry optional structured details. */
export class WorkflowError extends Error {
  public readonly code: WorkflowErrorCode;
  public readonly cause: unknown;
  public readonly details: ErrorDetails | undefined;

  constructor(message: string, options: WorkflowErrorOptions = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = options.code ?? WorkflowErrorCode.ERROR;
    this.cause = options.cause;
    this.details = options.details;
  }
}

export class WorkflowOptionsError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.OPTIONS_INVALID });
    this.name = "WorkflowOptionsError";
  }

  static positiveSafeInteger(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must be a positive safe integer`, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_POSITIVE_SAFE_INTEGER,
      details: { label },
    });
  }

  static nonNegativeSafeInteger(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} must be a non-negative safe integer`, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_NON_NEGATIVE_SAFE_INTEGER,
      details: { label },
    });
  }

  static cursorInvalid(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} cursor is invalid`, {
      code: WorkflowErrorCode.OPTIONS_CURSOR_INVALID,
      details: { label },
    });
  }

  static retryMaximumIntervalTooSmall(this: void, label: string): never {
    throw new WorkflowOptionsError(`${label} maximumInterval must be at least initialInterval`, {
      code: WorkflowErrorCode.OPTIONS_RETRY_MAXIMUM_INTERVAL_TOO_SMALL,
      details: { label },
    });
  }
}

export class WorkflowStateError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.STATE_INVALID });
    this.name = "WorkflowStateError";
  }

  static runNamespaceMismatch(this: void, actual: string, expected: string): never {
    throw new WorkflowStateError(`Workflow run namespace mismatch: ${actual} !== ${expected}`, {
      code: WorkflowErrorCode.STATE_RUN_NAMESPACE_MISMATCH,
      details: { actual, expected },
    });
  }

  static runIdAlreadyExists(this: void, runId: RunId): never {
    throw new WorkflowStateError(`Workflow run already exists: ${runId}`, {
      code: WorkflowErrorCode.STATE_RUN_ALREADY_EXISTS,
      details: { runId },
    });
  }

  static eventHistoryAlreadyExists(this: void, runId: RunId): never {
    throw new WorkflowStateError(`Workflow event history already exists: ${runId}`, {
      code: WorkflowErrorCode.STATE_EVENT_HISTORY_ALREADY_EXISTS,
      details: { runId },
    });
  }

  static eventNotTerminalStep(this: void, kind: EventKind): never {
    throw new WorkflowStateError(`Workflow event is not a terminal step event: ${kind}`, {
      code: WorkflowErrorCode.STATE_EVENT_NOT_TERMINAL_STEP,
      details: { kind },
    });
  }

  static idempotencyKeyClaimedWithoutRun(this: void, runId: RunId): never {
    throw new WorkflowStateError(`Workflow idempotency key was claimed without a run: ${runId}`, {
      code: WorkflowErrorCode.STATE_IDEMPOTENCY_KEY_CLAIMED_WITHOUT_RUN,
      details: { runId },
    });
  }

  static cleanupSelectedNonTerminalRun(this: void, runId: RunId): never {
    throw new WorkflowStateError(`Workflow cleanup selected non-terminal run: ${runId}`, {
      code: WorkflowErrorCode.STATE_CLEANUP_SELECTED_NON_TERMINAL_RUN,
      details: { runId },
    });
  }
}

export class WorkflowRunError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.RUN_ERROR });
    this.name = "WorkflowRunError";
  }
}

export class WorkflowStepError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.STEP_ERROR });
    this.name = "WorkflowStepError";
  }
}

export class WorkflowMessageError extends WorkflowError {
  constructor(message: string, options: WorkflowErrorOptions) {
    super(message, { ...options, code: options.code ?? WorkflowErrorCode.MESSAGE_ERROR });
    this.name = "WorkflowMessageError";
  }
}
