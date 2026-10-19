import { WorkflowError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

export class WorkflowCapabilityError extends WorkflowError {
  public readonly capability: string;

  constructor(capability: string) {
    super(`Workflow engine does not support ${capability}`, {
      code: WorkflowErrorCode.CAPABILITY_UNSUPPORTED,
      details: { capability },
    });
    this.name = "WorkflowCapabilityError";
    this.capability = capability;
  }

  static unsupported(this: void, capability: string): never {
    throw new WorkflowCapabilityError(capability);
  }
}
