import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowError } from "./base.ts";

/** Error thrown for invalid workflow runtime usage. */
export class WorkflowRuntimeError extends WorkflowError {
  constructor(message: string, context?: Function) {
    super(message, { code: WorkflowErrorCode.RUNTIME_INVALID }, context);
    this.name = "WorkflowRuntimeError";
  }

  static create(this: void, message: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError(message, WorkflowRuntimeError.create);
  }

  static invalid(this: void): never {
    throw new WorkflowRuntimeError("Workflow runtime is invalid", WorkflowRuntimeError.invalid);
  }

  static clientMissing(this: void): never {
    throw new WorkflowRuntimeError(
      "Workflow runtime is not backed by a workflow client",
      WorkflowRuntimeError.clientMissing,
    );
  }

  static registryMissing(this: void): never {
    throw new WorkflowRuntimeError(
      "Workflow runtime is not backed by a workflow registry",
      WorkflowRuntimeError.registryMissing,
    );
  }
}
