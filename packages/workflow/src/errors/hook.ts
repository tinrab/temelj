import type { ErrorDetails } from "../types/error.ts";

import { WorkflowOptionsError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

/** Errors caused by invalid hook or webhook tokens and hook state. */
export class WorkflowHookError extends WorkflowOptionsError {
  constructor(message: string, code: WorkflowErrorCode, details?: ErrorDetails) {
    super(message, { code, details });
    this.name = "WorkflowHookError";
  }

  static tokenInvalid(this: void): never {
    throw new WorkflowHookError(
      "Workflow hook token is invalid",
      WorkflowErrorCode.HOOK_TOKEN_INVALID,
      undefined,
    );
  }
}
