import type { Schema, SchemaOutput } from "@temelj/standard-schema";

import { decodeBase64UrlString } from "@temelj/string";
import { z } from "zod";

import type { WorkflowErrorRecord } from "./error.ts";
import type { MessageId } from "./message-id.ts";
import type { RunId } from "./run.ts";

import { WorkflowHookError } from "../errors/mod.ts";
import { nonBlankStringSchema } from "./common.ts";
import { messageIdSchema } from "./message-id.ts";
import { runIdSchema } from "./run-id.ts";
import { workflowPersistedValueSchema } from "./run.ts";

export const WORKFLOW_HOOK_TOKEN_PREFIX = "temelj-hook:";
export const WORKFLOW_HOOK_TOKEN_VERSION = "v1";

export const workflowHookKindSchema = z.enum(["hook", "webhook"]);

export const workflowHookTokenPayloadSchema = z.object({
  v: z.literal(1).optional(),
  runId: runIdSchema,
  name: nonBlankStringSchema,
  messageId: messageIdSchema,
  kind: workflowHookKindSchema.optional(),
  metadata: workflowPersistedValueSchema.optional(),
});

export const workflowHookTokenSchema = nonBlankStringSchema.refine(
  (token) => token.startsWith(WORKFLOW_HOOK_TOKEN_PREFIX),
  { error: "Workflow hook token is invalid" },
);

/** Decoded fields carried by a workflow webhook resume token. */
export const parsedWorkflowWebhookTokenSchema = z.object({
  runId: runIdSchema,
  name: nonBlankStringSchema,
  messageId: messageIdSchema,
});

export const parsedWorkflowHookTokenSchema = parsedWorkflowWebhookTokenSchema.extend({
  kind: workflowHookKindSchema,
  metadata: workflowPersistedValueSchema.optional(),
});

/** Parses a workflow hook token and throws WorkflowHookError when it is invalid. */
export function parseHookToken(token: string): ParsedWorkflowHookToken {
  const parsedToken = workflowHookTokenSchema.safeParse(token);
  if (!parsedToken.success) {
    WorkflowHookError.tokenInvalid();
  }
  const tokenValue = parsedToken.data;
  const body = tokenValue.slice(WORKFLOW_HOOK_TOKEN_PREFIX.length);
  if (body.startsWith(`${WORKFLOW_HOOK_TOKEN_VERSION}:`)) {
    try {
      const payload = JSON.parse(
        decodeBase64UrlString(body.slice(WORKFLOW_HOOK_TOKEN_VERSION.length + 1)),
      );
      const hook = workflowHookTokenPayloadSchema.safeParse(payload);
      if (!hook.success) {
        WorkflowHookError.tokenInvalid();
      }
      const parsedHook = parsedWorkflowHookTokenSchema.safeParse({
        runId: hook.data.runId,
        name: hook.data.name,
        messageId: hook.data.messageId,
        kind: hook.data.kind ?? "hook",
        ...(hook.data.metadata === undefined ? {} : { metadata: hook.data.metadata }),
      });
      if (!parsedHook.success) {
        WorkflowHookError.tokenInvalid();
      }
      return parsedHook.data;
    } catch (error) {
      if (!(error instanceof WorkflowHookError)) {
        WorkflowHookError.tokenInvalid();
      }
      WorkflowHookError.tokenInvalid();
    }
  }
  WorkflowHookError.tokenInvalid();
}

/** Parses a workflow webhook token and throws a webhook-specific options error when invalid. */
export function parseWebhookToken(token: string): ParsedWorkflowHookToken {
  try {
    return parseHookToken(token);
  } catch (error) {
    if (error instanceof WorkflowHookError) {
      WorkflowHookError.webhookTokenInvalid();
    }
    throw error;
  }
}

/** Promise-like handle for a message-backed workflow hook created by workflow code. */
export interface Hook<TPayload = unknown> extends PromiseLike<TPayload> {
  /** Opaque token used by external code to resume or dispose the hook. */
  readonly token: string;
  /** Run ID that owns the waiting hook. */
  readonly runId: RunId;
  /** Hook name supplied when the hook was created. */
  readonly name: string;
  /** Message ID that will resume the hook. */
  readonly messageId: MessageId;
  /** Waits until the hook receives a payload, fails, expires, or is disposed. */
  wait(): Promise<TPayload>;
}

/** Promise-like handle for a webhook-backed workflow hook created by workflow code. */
export interface Webhook<TPayload = unknown> extends PromiseLike<TPayload> {
  /** Opaque token used by external code to resume or dispose the webhook hook. */
  readonly token: string;
  /** Run ID that owns the waiting webhook hook. */
  readonly runId: RunId;
  /** Webhook hook name supplied when the hook was created. */
  readonly name: string;
  /** Message ID that will resume the webhook hook. */
  readonly messageId: MessageId;
  /** Optional persisted metadata encoded into the webhook token. */
  readonly metadata?: unknown;
  /** Waits until the webhook hook receives a payload, fails, expires, or is disposed. */
  wait(): Promise<TPayload>;
}

/** Options for creating a message-backed external resume hook. */
export interface CreateHookOptions<TSchema extends Schema | undefined = undefined> {
  readonly commandId?: string;
  readonly name: string;
  readonly messageId?: MessageId;
  readonly timeout?: Temporal.Duration;
  readonly schema?: TSchema;
}

/** Options for creating a webhook-labeled external resume hook. */
export interface CreateWebhookOptions<
  TSchema extends Schema | undefined = undefined,
> extends CreateHookOptions<TSchema> {
  readonly metadata?: unknown;
}

/** Options for completing an external resume hook. */
export interface ResumeHookOptions {
  readonly payload?: unknown;
  readonly idempotencyKey?: string;
}

/** Options for completing a webhook-labeled external resume hook. */
export type ResumeWebhookOptions = ResumeHookOptions;

/** Kind of external resume token represented in hook inspection data. */
export type HookKind = "hook" | "webhook";

/** Payload encoded into a workflow hook token before it is given to external systems. */
export interface HookTokenPayload {
  readonly v?: 1;
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: MessageId;
  readonly kind?: HookKind;
  readonly metadata?: unknown;
}

/** Opaque token string used to resume or dispose an external workflow hook. */
export type HookToken = string;

/** Observed lifecycle status of an external resume token. */
export type HookInspectionStatus =
  | "waiting"
  | "completed"
  | "failed"
  | "disposed"
  | "expired"
  | "run-terminal"
  | "not-found";

/** Inspection record for an external resume token and its recorded outcome. */
export interface HookInspection {
  readonly token: string;
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: MessageId;
  readonly kind: HookKind;
  readonly status: HookInspectionStatus;
  readonly stepId?: string;
  readonly timeoutAt?: Temporal.Instant;
  readonly metadata?: unknown;
  readonly payload?: unknown;
  readonly error?: WorkflowErrorRecord;
}

/** Decoded fields carried by a workflow webhook resume token. */
export interface ParsedWorkflowWebhookToken {
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: MessageId;
}

/** Decoded fields carried by any workflow hook token, including webhook tokens. */
export interface ParsedWorkflowHookToken extends ParsedWorkflowWebhookToken {
  readonly kind: HookKind;
  readonly metadata?: unknown;
}

/** Alias for message-backed hook handles. */
export type HookCreator<TPayload = unknown> = Hook<TPayload>;

/** Alias for webhook-backed hook handles. */
export type WebhookCreator<TPayload = unknown> = Webhook<TPayload>;

/** Minimal hook creation surface exposed on the workflow step API. */
export interface WorkflowStepHookCreateApi {
  /** Creates a message-backed external resume hook. */
  create<TPayload = unknown>(options: CreateHookOptions): Hook<TPayload>;
  /** Creates a message-backed external resume hook with schema-validated payloads. */
  create<const TSchema extends Schema>(
    options: CreateHookOptions<TSchema>,
  ): Hook<SchemaOutput<TSchema>>;
  /** Creates a webhook-labeled external resume hook. */
  createWebhook<TPayload = unknown>(options: CreateWebhookOptions): Webhook<TPayload>;
  /** Creates a webhook-labeled external resume hook with schema-validated payloads. */
  createWebhook<const TSchema extends Schema>(
    options: CreateWebhookOptions<TSchema>,
  ): Webhook<SchemaOutput<TSchema>>;
}
