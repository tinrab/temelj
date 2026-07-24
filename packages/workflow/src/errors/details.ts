import type { WorkflowErrorDetails, WorkflowErrorRecord } from "../types/error.ts";
import type { WorkflowRunStatus, WorkflowTerminalRunStatus } from "../types/run.ts";

import { positiveSafeIntegerSchema } from "../types/common.ts";
import { workflowErrorCodeSchema } from "../types/error-code.ts";
import {
  optionalWorkflowErrorStringSchema,
  sanitizedWorkflowErrorDetails,
  workflowErrorDetailsSchema,
  workflowErrorRunStatusSchema,
  workflowTerminalErrorRunStatusSchema,
} from "../types/error.ts";

export function hasWorkflowErrorCauseDetails(details: WorkflowErrorDetails): boolean {
  return (
    workflowErrorDetailString(details, "causeName") !== undefined ||
    workflowErrorDetailString(details, "causeMessage") !== undefined
  );
}

export function unprefixWorkflowErrorCauseDetails(
  details: WorkflowErrorDetails,
): WorkflowErrorRecord {
  const unprefixed = Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => /^cause[A-Z]/.test(key))
      .map(([key, value]) => {
        const unprefixedKey = key.slice("cause".length);
        return [`${unprefixedKey[0]?.toLowerCase() ?? ""}${unprefixedKey.slice(1)}`, value];
      }),
  );
  const name =
    typeof unprefixed.name === "string" && unprefixed.name.trim() !== ""
      ? unprefixed.name
      : "WorkflowError";
  const message =
    typeof unprefixed.message === "string" && unprefixed.message.trim() !== ""
      ? unprefixed.message
      : name;
  const stack =
    typeof unprefixed.stack === "string" && unprefixed.stack.trim() !== ""
      ? unprefixed.stack
      : undefined;
  const code = workflowErrorCodeSchema.safeParse(unprefixed.code);
  const publicDetails = Object.fromEntries(
    Object.entries(unprefixed).filter(
      ([key]) => key !== "code" && key !== "name" && key !== "message" && key !== "stack",
    ),
  );
  const sanitizedDetails = sanitizedWorkflowErrorDetails(publicDetails);
  return {
    ...(code.success ? { code: code.data } : {}),
    name,
    message,
    ...(stack === undefined ? {} : { stack }),
    ...(sanitizedDetails === undefined ? {} : { details: sanitizedDetails }),
  };
}

export function workflowErrorDetailString(
  details: WorkflowErrorDetails | undefined,
  key: string,
): string | undefined {
  const parsed = workflowErrorDetailsSchema.safeParse(details);
  if (!parsed.success) {
    return undefined;
  }
  const result = optionalWorkflowErrorStringSchema.safeParse(parsed.data[key]);
  return result.success ? result.data : undefined;
}

export function workflowErrorDetailPositiveSafeInteger(
  details: WorkflowErrorDetails | undefined,
  key: string,
): number | undefined {
  const parsed = workflowErrorDetailsSchema.safeParse(details);
  if (!parsed.success) {
    return undefined;
  }
  const result = positiveSafeIntegerSchema.optional().safeParse(parsed.data[key]);
  return result.success ? result.data : undefined;
}

export function workflowErrorRunStatusOrUndefined(value: unknown): WorkflowRunStatus | undefined {
  const result = workflowErrorRunStatusSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function workflowTerminalErrorRunStatusOrUndefined(
  value: unknown,
): WorkflowTerminalRunStatus | undefined {
  const result = workflowTerminalErrorRunStatusSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function workflowErrorDetailTimestamp(
  details: WorkflowErrorDetails | undefined,
  key: string,
): Temporal.Instant | undefined {
  const value = workflowErrorDetailString(details, key);
  if (value === undefined) {
    return undefined;
  }
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}

export function workflowErrorDetailDuration(
  details: WorkflowErrorDetails | undefined,
  key: string,
): Temporal.Duration | undefined {
  const value = workflowErrorDetailString(details, key);
  if (value === undefined) {
    return undefined;
  }
  try {
    return Temporal.Duration.from(value);
  } catch {
    return undefined;
  }
}
