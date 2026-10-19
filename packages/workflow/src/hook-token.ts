import type { StorageValue } from "@temelj/storage";

import { ss } from "@temelj/standard-schema";
import { decodeBase64UrlString } from "@temelj/string";

import type { HookTokenPayload } from "./types/hook.ts";

import { WorkflowHookError } from "./errors/mod.ts";
import { nonBlankStringSchema, idSchema } from "./schema/common.ts";
import { persistedValueSchema } from "./schema/persisted-value.ts";

export const WORKFLOW_HOOK_TOKEN_PREFIX = "temelj-hook:";

export const WORKFLOW_HOOK_TOKEN_VERSION = "v1";

const hookTokenPayloadSchema = ss.object({
  runId: idSchema,
  name: nonBlankStringSchema,
  messageId: idSchema,
  kind: ss.picklist(["hook", "webhook"]),
  metadata: ss.optional(persistedValueSchema),
});

/** Decodes a hook or webhook token without resuming it, and throws WorkflowHookError when invalid. */
export function parseHookToken(token: string): HookTokenPayload {
  const versionPrefix = `${WORKFLOW_HOOK_TOKEN_PREFIX}${WORKFLOW_HOOK_TOKEN_VERSION}:`;

  if (!token.startsWith(versionPrefix)) {
    WorkflowHookError.tokenInvalid();
  }

  let payload: StorageValue;

  try {
    payload = JSON.parse(decodeBase64UrlString(token.slice(versionPrefix.length)));
  } catch {
    WorkflowHookError.tokenInvalid();
  }

  const hook = ss.safeParseSync(hookTokenPayloadSchema, payload);

  if (!hook.success) {
    WorkflowHookError.tokenInvalid();
  }

  return hook.value;
}
