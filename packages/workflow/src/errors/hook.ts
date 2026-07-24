import type { WorkflowErrorCode as WorkflowErrorCodeType } from "../types/error-code.ts";
import type { WorkflowErrorDetails } from "../types/error.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowOptionsError } from "./base.ts";

/** Errors caused by invalid hook or webhook tokens and hook state. */
export class WorkflowHookError extends WorkflowOptionsError {
  constructor(
    message: string,
    code: WorkflowErrorCodeType,
    details?: WorkflowErrorDetails,
    context?: Function,
  ) {
    super(message, context, { code, details });
    this.name = "WorkflowHookError";
  }

  static tokenInvalid(this: void): never {
    throw new WorkflowHookError(
      "Workflow hook token is invalid",
      WorkflowErrorCode.HOOK_TOKEN_INVALID,
      undefined,
      WorkflowHookError.tokenInvalid,
    );
  }

  static webhookTokenInvalid(this: void): never {
    throw new WorkflowHookError(
      "Workflow webhook token is invalid",
      WorkflowErrorCode.WEBHOOK_TOKEN_INVALID,
      undefined,
      WorkflowHookError.webhookTokenInvalid,
    );
  }

  static tokenNotUnique(this: void, kind: "hook" | "webhook", name: string): never {
    throw new WorkflowHookError(
      `Workflow ${kind} token must be unique within a run: ${name}`,
      WorkflowErrorCode.HOOK_TOKEN_NOT_UNIQUE,
      { kind, name },
      WorkflowHookError.tokenNotUnique,
    );
  }

  static waitingStepMissing(this: void): never {
    throw new WorkflowHookError(
      "Workflow hook inspection is missing a waiting step id",
      WorkflowErrorCode.HOOK_WAITING_STEP_MISSING,
      undefined,
      WorkflowHookError.waitingStepMissing,
    );
  }
}
