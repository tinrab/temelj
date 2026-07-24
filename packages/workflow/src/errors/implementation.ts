import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowError } from "./base.ts";

/** Error thrown for implementation not found failures. */
export class WorkflowImplementationNotFoundError extends WorkflowError {
  public readonly workflowName: string;
  public readonly workflowVersion: string | undefined;

  constructor(workflowName: string, workflowVersion?: string, context?: Function) {
    super(
      workflowVersion === undefined
        ? `Workflow implementation not found: ${workflowName}`
        : `Workflow implementation not found: ${workflowName}@${workflowVersion}`,
      {
        code: WorkflowErrorCode.IMPLEMENTATION_NOT_FOUND,
        details: {
          workflowName,
          ...(workflowVersion === undefined ? {} : { workflowVersion }),
        },
      },
      context,
    );
    this.name = "WorkflowImplementationNotFoundError";
    this.workflowName = workflowName;
    this.workflowVersion = workflowVersion;
  }

  static create(
    this: void,
    workflowName: string,
    workflowVersion?: string,
  ): WorkflowImplementationNotFoundError {
    return new WorkflowImplementationNotFoundError(
      workflowName,
      workflowVersion,
      WorkflowImplementationNotFoundError.create,
    );
  }
}
