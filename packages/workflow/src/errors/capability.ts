import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowError } from "./base.ts";

/** Error thrown for capability failures. */
export class WorkflowCapabilityError extends WorkflowError {
  public readonly capability: string;

  constructor(capability: string, context?: Function) {
    super(
      `Workflow engine does not support ${capability}`,
      {
        code: WorkflowErrorCode.CAPABILITY_UNSUPPORTED,
        details: { capability },
      },
      context,
    );
    this.name = "WorkflowCapabilityError";
    this.capability = capability;
  }

  static create(this: void, capability: string): WorkflowCapabilityError {
    return new WorkflowCapabilityError(capability, WorkflowCapabilityError.create);
  }

  static unsupported(this: void, capability: string): never {
    throw new WorkflowCapabilityError(capability, WorkflowCapabilityError.unsupported);
  }
}
