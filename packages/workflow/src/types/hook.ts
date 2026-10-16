import type { Schema, SchemaOutput } from "@temelj/standard-schema";
import type { StorageValue } from "@temelj/storage";

import type { WorkflowErrorRecord } from "./error.ts";
import type { MessageId, RunId } from "./ids.ts";

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
  readonly metadata?: StorageValue;
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
  readonly metadata?: StorageValue;
}

export interface ResumeHookOptions {
  readonly payload?: unknown;
  readonly idempotencyKey?: string;
}

/** Kind of external resume token represented in hook inspection data. */
export type HookKind = "hook" | "webhook";

/** Payload encoded into a workflow hook token before it is given to external systems. */
export interface HookTokenPayload {
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: MessageId;
  readonly kind: HookKind;
  readonly metadata?: StorageValue;
}

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
  readonly metadata?: StorageValue;
  readonly payload?: StorageValue;
  readonly error?: WorkflowErrorRecord;
}

/** Minimal hook creation surface exposed on the workflow step API. */
export interface StepHookCreateApi {
  /** Creates a message-backed external resume hook. */
  create(options: CreateHookOptions): Hook<StorageValue | undefined>;
  /** Creates a message-backed external resume hook with schema-validated payloads. */
  create<const TSchema extends Schema>(
    options: CreateHookOptions<TSchema> & { readonly schema: TSchema },
  ): Hook<SchemaOutput<TSchema>>;
  /** Creates a webhook-labeled external resume hook. */
  createWebhook(options: CreateWebhookOptions): Webhook<StorageValue | undefined>;
  /** Creates a webhook-labeled external resume hook with schema-validated payloads. */
  createWebhook<const TSchema extends Schema>(
    options: CreateWebhookOptions<TSchema> & { readonly schema: TSchema },
  ): Webhook<SchemaOutput<TSchema>>;
}
