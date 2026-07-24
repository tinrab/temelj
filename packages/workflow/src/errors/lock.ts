import type { WorkflowErrorCode as WorkflowErrorCodeType } from "../types/error-code.ts";
import type { WorkflowErrorDetails } from "../types/error.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowOptionsError, WorkflowStateError } from "./base.ts";

/** Errors caused by invalid persisted lock state or exhausted lock updates. */
export class WorkflowLockStateError extends WorkflowStateError {
  constructor(
    message: string,
    code: WorkflowErrorCodeType,
    details?: WorkflowErrorDetails,
    context?: Function,
  ) {
    super(message, context, { code, details });
    this.name = "WorkflowLockStateError";
  }

  static namespaceMismatch(this: void, actual: string, expected: string): never {
    throw new WorkflowLockStateError(
      `Workflow lock namespace mismatch: ${actual} !== ${expected}`,
      WorkflowErrorCode.LOCK_NAMESPACE_MISMATCH,
      { actual, expected },
      WorkflowLockStateError.namespaceMismatch,
    );
  }

  static keyChangeRejected(this: void): never {
    throw new WorkflowLockStateError(
      "Workflow lock key cannot change",
      WorkflowErrorCode.LOCK_KEY_CHANGE_REJECTED,
      undefined,
      WorkflowLockStateError.keyChangeRejected,
    );
  }

  static currentRecordInvalid(this: void): never {
    throw new WorkflowLockStateError(
      "Current workflow lock record is invalid",
      WorkflowErrorCode.LOCK_CURRENT_RECORD_INVALID,
      undefined,
      WorkflowLockStateError.currentRecordInvalid,
    );
  }

  static nextRecordInvalid(this: void): never {
    throw new WorkflowLockStateError(
      "Next workflow lock record is invalid",
      WorkflowErrorCode.LOCK_NEXT_RECORD_INVALID,
      undefined,
      WorkflowLockStateError.nextRecordInvalid,
    );
  }

  static acquireConflictExhausted(this: void, key: string): never {
    throw new WorkflowLockStateError(
      `Failed to acquire workflow lock ${key}`,
      WorkflowErrorCode.LOCK_ACQUIRE_CONFLICT_EXHAUSTED,
      { key },
      WorkflowLockStateError.acquireConflictExhausted,
    );
  }

  static notFound(this: void, key: string): never {
    throw new WorkflowLockStateError(
      `Workflow lock not found: ${key}`,
      WorkflowErrorCode.LOCK_NOT_FOUND,
      { key },
      WorkflowLockStateError.notFound,
    );
  }

  static releaseConflictExhausted(this: void, key: string): never {
    throw new WorkflowLockStateError(
      `Failed to release workflow lock ${key}`,
      WorkflowErrorCode.LOCK_RELEASE_CONFLICT_EXHAUSTED,
      { key },
      WorkflowLockStateError.releaseConflictExhausted,
    );
  }

  static staleReleaseConflictExhausted(this: void, key: string): never {
    throw new WorkflowLockStateError(
      `Failed to release stale workflow lock ${key}`,
      WorkflowErrorCode.LOCK_STALE_RELEASE_CONFLICT_EXHAUSTED,
      { key },
      WorkflowLockStateError.staleReleaseConflictExhausted,
    );
  }
}

/** Errors caused by invalid lock operations or lock options. */
export class WorkflowLockError extends WorkflowOptionsError {
  constructor(
    message: string,
    code: WorkflowErrorCodeType,
    details?: WorkflowErrorDetails,
    context?: Function,
  ) {
    super(message, context, { code, details });
    this.name = "WorkflowLockError";
  }

  static alreadyHeld(this: void, key: string): never {
    throw new WorkflowLockError(
      `Workflow lock is already held: ${key}`,
      WorkflowErrorCode.LOCK_ALREADY_HELD_WITHOUT_WAIT,
      { key },
      WorkflowLockError.alreadyHeld,
    );
  }

  static holderMismatch(this: void, key: string): never {
    throw new WorkflowLockError(
      `Workflow lock holder mismatch: ${key}`,
      WorkflowErrorCode.LOCK_HOLDER_MISMATCH,
      { key },
      WorkflowLockError.holderMismatch,
    );
  }

  static alreadyReleased(this: void, key: string): never {
    throw new WorkflowLockError(
      `Workflow lock is already released: ${key}`,
      WorkflowErrorCode.LOCK_ALREADY_RELEASED,
      { key },
      WorkflowLockError.alreadyReleased,
    );
  }

  static notStale(this: void, key: string): never {
    throw new WorkflowLockError(
      `Workflow lock is not stale: ${key}`,
      WorkflowErrorCode.LOCK_NOT_STALE,
      { key },
      WorkflowLockError.notStale,
    );
  }

  static waitDeadlineConflict(this: void): never {
    throw new WorkflowLockError(
      "Workflow lock options cannot include both waitTimeout and waitDeadlineAt",
      WorkflowErrorCode.LOCK_WAIT_DEADLINE_CONFLICT,
      undefined,
      WorkflowLockError.waitDeadlineConflict,
    );
  }

  static timeoutRequiresWait(this: void): never {
    throw new WorkflowLockError(
      "Workflow lock timeout options require wait: true",
      WorkflowErrorCode.LOCK_TIMEOUT_REQUIRES_WAIT,
      undefined,
      WorkflowLockError.timeoutRequiresWait,
    );
  }
}
