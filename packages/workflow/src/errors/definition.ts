import { WorkflowError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

export class WorkflowDefinitionError extends WorkflowError {
  constructor(message: string) {
    super(message, { code: WorkflowErrorCode.DEFINITION_INVALID });
    this.name = "WorkflowDefinitionError";
  }

  static compiledMetadataMissing(this: void): never {
    throw new WorkflowDefinitionError(
      "Compiled workflow function is missing compiled workflow metadata",
    );
  }

  static implementationNotBundled(this: void, key: string): never {
    throw new WorkflowDefinitionError(
      `Workflow implementation is not included in the workflow bundle: ${key}`,
    );
  }
}
