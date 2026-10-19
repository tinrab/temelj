import type { ErrorDetails } from "../types/error.ts";

import { WorkflowOptionsError, WorkflowStateError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

/** Errors caused by invalid persisted lock state or exhausted lock updates. */
export class WorkflowLockStateError extends WorkflowStateError {
  constructor(message: string, code: WorkflowErrorCode, details?: ErrorDetails) {
    super(message, { code, details });
    this.name = "WorkflowLockStateError";
  }

  static namespaceMismatch(this: void, actual: string, expected: string): never {
    throw new WorkflowLockStateError(
      `Workflow lock namespace mismatch: ${actual} !== ${expected}`,
      WorkflowErrorCode.LOCK_NAMESPACE_MISMATCH,
      { actual, expected },
    );
  }

  static notFound(this: void, key: string): never {
    throw new WorkflowLockStateError(
      `Workflow lock not found: ${key}`,
      WorkflowErrorCode.LOCK_NOT_FOUND,
      { key },
    );
  }
}

/** Errors caused by invalid lock operations or lock options. */
export class WorkflowLockError extends WorkflowOptionsError {
  constructor(message: string, code: WorkflowErrorCode, details?: ErrorDetails) {
    super(message, { code, details });
    this.name = "WorkflowLockError";
  }
}
