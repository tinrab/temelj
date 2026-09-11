import { isObject } from "@temelj/value";

import type { WorkflowErrorCode as WorkflowErrorCodeType } from "../types/error-code.ts";
import type { WorkflowErrorDetails } from "../types/error.ts";

import { workflowErrorCodeSchema } from "../types/error-code.ts";
import { workflowErrorDetailsSchema } from "../types/error.ts";

export interface WorkflowErrorRecordView {
  readonly code: WorkflowErrorCodeType;
  readonly details?: WorkflowErrorDetails;
}

/** Safely exposes fields shared by live workflow errors and persisted workflow error records. */
export function workflowErrorRecordView(cause: unknown): WorkflowErrorRecordView | undefined {
  if (!isObject(cause)) {
    return undefined;
  }

  const code = "code" in cause ? workflowErrorCodeSchema.safeParse(cause.code) : undefined;

  if (code === undefined || !code.success) {
    return undefined;
  }

  if (!("details" in cause) || cause.details === undefined) {
    return { code: code.data };
  }

  const details = workflowErrorDetailsSchema.safeParse(cause.details);

  return details.success ? { code: code.data, details: details.data } : undefined;
}
