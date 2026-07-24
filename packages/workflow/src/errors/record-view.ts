import type { WorkflowErrorCode as WorkflowErrorCodeType } from "../types/error-code.ts";
import type { WorkflowErrorDetails } from "../types/error.ts";

import { workflowErrorCodeSchema } from "../types/error-code.ts";

export interface WorkflowErrorRecordView {
  readonly code: WorkflowErrorCodeType;
  readonly details?: WorkflowErrorDetails;
}

/** Safely exposes fields shared by live workflow errors and persisted workflow error records. */
export function workflowErrorRecordView(error: unknown): WorkflowErrorRecordView | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = "code" in error ? workflowErrorCodeSchema.safeParse(error.code) : undefined;
  if (code === undefined || !code.success) {
    return undefined;
  }
  if (!("details" in error) || error.details === undefined) {
    return { code: code.data };
  }
  const details = workflowErrorDetailsView(error.details);
  return details === undefined ? undefined : { code: code.data, details };
}

function workflowErrorDetailsView(details: unknown): WorkflowErrorDetails | undefined {
  if (typeof details !== "object" || details === null || Array.isArray(details)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(details);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  const entries = Object.entries(details);
  if (
    entries.some(
      ([key, value]) =>
        key.trim() === "" ||
        !(
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
        ),
    )
  ) {
    return undefined;
  }
  return Object.fromEntries(entries);
}
