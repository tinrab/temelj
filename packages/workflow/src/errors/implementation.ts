import type { ImplementationErrorDetails } from "../types/error.ts";

import { WorkflowError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

export class WorkflowImplementationNotFoundError extends WorkflowError {
  public readonly workflowName: string;
  public readonly workflowVersion: string | undefined;

  constructor(workflowName: string, workflowVersion?: string) {
    const details: ImplementationErrorDetails = { workflowName };

    if (workflowVersion !== undefined) details.workflowVersion = workflowVersion;
    super(
      workflowVersion === undefined
        ? `Workflow implementation not found: ${workflowName}`
        : `Workflow implementation not found: ${workflowName}@${workflowVersion}`,
      {
        code: WorkflowErrorCode.IMPLEMENTATION_NOT_FOUND,
        details,
      },
    );
    this.name = "WorkflowImplementationNotFoundError";
    this.workflowName = workflowName;
    this.workflowVersion = workflowVersion;
  }
}
