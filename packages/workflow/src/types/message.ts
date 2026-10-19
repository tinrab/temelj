import type { Schema } from "@temelj/standard-schema";

import type { MessageId, RunId } from "./ids.ts";
import type { ListRunsOptions } from "./run-list.ts";

/** Schema-validated message channel bound to one durable message ID. */
export interface MessageChannel<TPayload = unknown, TRawPayload = unknown> {
  readonly name: string;
  readonly schema: Schema<TRawPayload, TPayload>;
}

/** Configuration for defining a typed message channel. */
export interface MessageChannelConfig<TPayload, TRawPayload = unknown> {
  readonly name: string;
  readonly schema: Schema<TRawPayload, TPayload>;
}

/** Options for sending a concrete message id to a workflow run. */
export interface SendMessageOptions {
  readonly messageId: MessageId;
  readonly payload?: unknown;
  readonly idempotencyKey?: string;
}

export interface SendMessageChannelOptions<TPayload = unknown> {
  readonly payload?: TPayload;
  readonly idempotencyKey?: string;
}

/** Object form for sending through a typed message channel. */
export interface SendMessageChannelObject<
  TPayload = unknown,
  TRawPayload = TPayload,
> extends SendMessageChannelOptions<TRawPayload> {
  readonly channel: MessageChannel<TPayload, TRawPayload>;
}

/** Accepted input forms for sending a message to one run. */
export type SendMessageInput = SendMessageOptions | SendMessageChannelObject;

/** Options for broadcasting a concrete message id to matching runs. */
export interface BroadcastMessageOptions extends SendMessageOptions {
  readonly payload?: unknown;
  readonly target?: ListRunsOptions;
}

/** Options for broadcasting through a typed message channel to matching runs. */
export interface BroadcastMessageChannelOptions<
  TPayload = unknown,
> extends SendMessageChannelOptions<TPayload> {
  readonly target?: ListRunsOptions;
}

/** Object form for broadcasting through a typed message channel. */
export interface BroadcastMessageChannelObject<
  TPayload = unknown,
  TRawPayload = TPayload,
> extends BroadcastMessageChannelOptions<TRawPayload> {
  readonly channel: MessageChannel<TPayload, TRawPayload>;
}

/** Accepted input forms for broadcasting a message to matching runs. */
export type BroadcastMessageInput = BroadcastMessageOptions | BroadcastMessageChannelObject;

/** Summary returned after broadcasting a message to matching runs. */
export interface BroadcastMessageResult {
  readonly messageId: MessageId;
  readonly runIds: RunId[];
  readonly deliveredMessages: number;
}

/** Options for waiting on a concrete message id from workflow code. */
export interface WaitForMessageOptions<TSchema extends Schema | undefined = undefined> {
  readonly commandId?: string;
  readonly name?: string;
  readonly messageId: MessageId;
  readonly timeout?: Temporal.Duration;
  readonly schema?: TSchema;
}

/** Options for waiting through a typed message channel from workflow code. */
export interface WaitForMessageChannelOptions {
  readonly commandId?: string;
  readonly name?: string;
  readonly timeout?: Temporal.Duration;
}

/** Sends messages to workflow runs, by message ID or through a typed channel. */
export interface MessageSender {
  /** Sends a named message to a workflow run. */
  send(runId: RunId, options: SendMessageInput): Promise<void>;
  /** Sends a payload through a typed message channel to a workflow run. */
  send<TPayload, TRawPayload = TPayload>(
    runId: RunId,
    channel: MessageChannel<TPayload, TRawPayload>,
    options?: SendMessageChannelOptions<TRawPayload>,
  ): Promise<void>;
}
