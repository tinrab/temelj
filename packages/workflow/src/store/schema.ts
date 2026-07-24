import type { StorageValue } from "@temelj/storage";

import { z } from "zod";

import { nonBlankStringSchema, temporalInstantSchema } from "../types/common.ts";
import { messageIdSchema } from "../types/message-id.ts";
import { runIdSchema } from "../types/run-id.ts";
import { persistedValueIssue } from "../types/run.ts";

export const workflowCleanupIndexKeySchema = z.object({
  key: nonBlankStringSchema,
  value: z.custom<StorageValue>(
    (value) =>
      value !== undefined &&
      persistedValueIssue(value, "value", new WeakSet<object>(), true) === undefined,
  ),
});

export const workflowMessageIdempotencyIndexSchema = z.object({
  runId: runIdSchema,
  messageId: messageIdSchema,
  timestamp: temporalInstantSchema,
});
