// This module uses Temporal while loading, so the polyfill must be installed first.
import "temporal-polyfill/global";
import type { ImplementationErrorDetails, WorkflowErrorRecord } from "../types/error.ts";

import { WorkflowImplementationNotFoundError } from "../errors/implementation.ts";
import { WorkflowRunDeadlineExceededError } from "../errors/run.ts";

export function toWorkerErrorRecord(cause: unknown): WorkflowErrorRecord {
  if (!(cause instanceof Error)) {
    return {
      name: "WorkflowNonErrorThrow",
      message: String(cause),
    };
  }

  return {
    name: cause.name,
    message: cause.message,
    stack: cause.stack,
    details: errorRecordDetails(cause),
  };
}

function errorRecordDetails(cause: Error): WorkflowErrorRecord["details"] {
  if (cause instanceof WorkflowRunDeadlineExceededError) {
    return { runId: cause.runId, deadlineAt: cause.deadlineAt.toString() };
  }

  if (cause instanceof WorkflowImplementationNotFoundError) {
    const details: ImplementationErrorDetails = { workflowName: cause.workflowName };

    if (cause.workflowVersion !== undefined) {
      details.workflowVersion = cause.workflowVersion;
    }

    return details;
  }

  return undefined;
}
