import { ss, type Schema } from "@temelj/standard-schema";
import { isPlainObject } from "@temelj/value";

import type { ErrorDetails, WorkflowErrorRecord } from "../types/error.ts";
import type { RunStatus, TerminalRunStatus } from "../types/run.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import { nonBlankStringSchema } from "./common.ts";

// SAFETY: WorkflowErrorCode is a non-empty table of codes.
export const errorCodeSchema: Schema<unknown, WorkflowErrorCode> = ss.picklist(
  Object.values(WorkflowErrorCode) as [WorkflowErrorCode, ...WorkflowErrorCode[]],
);

const runStatuses = ["pending", "running", "waiting", "completed", "failed", "canceled"] as const;

const terminalRunStatuses = ["completed", "failed", "canceled"] as const;

const errorDetailSchema = ss.union([
  ss.string(),
  ss.number(),
  ss.boolean(),
  ss.literal(null),
  ss.literal(undefined),
]);

export const errorDetailsSchema: Schema<unknown, ErrorDetails> = ss.refine(
  ss.pipe(
    ss.schema((value) =>
      isPlainObject(value) ? ss.success(value) : ss.failure("Expected an object"),
    ),
    ss.record(errorDetailSchema),
  ),
  (details) => Object.keys(details).every((key) => key.trim().length > 0),
  "Expected non-blank detail keys",
);

export const errorRecordSchema: Schema<unknown, WorkflowErrorRecord> = ss.object({
  code: ss.optional(errorCodeSchema),
  name: nonBlankStringSchema,
  message: nonBlankStringSchema,
  stack: ss.optional(nonBlankStringSchema),
  details: ss.optional(errorDetailsSchema),
});

export const optionalErrorStringSchema: Schema<unknown, string | undefined> =
  ss.optional(nonBlankStringSchema);

export const errorRunStatusSchema: Schema<unknown, RunStatus> = ss.picklist(
  runStatuses,
  "Expected a workflow run status",
);

export const terminalErrorRunStatusSchema: Schema<unknown, TerminalRunStatus> = ss.picklist(
  terminalRunStatuses,
  "Expected a terminal workflow run status",
);
