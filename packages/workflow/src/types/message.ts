import type { Schema } from "@temelj/standard-schema";

import type { MessageId } from "./message-id.ts";
import type { RunId } from "./run-id.ts";
import type { WorkflowListRunsOptions } from "./run-list.ts";
export type { MessageId } from "./message-id.ts";

/** Typed message channel that maps optional keys to durable message ids. */
export interface MessageChannel<TPayload = unknown, TKey = void> {
  readonly name: string;
  readonly schema?: Schema;
  readonly resolveMessageId: (...args: MessageChannelKeyArgs<TKey>) => MessageId;
  readonly types?: MessageChannelTypes<TPayload, TKey>;
}

/** Compile-time payload and key markers carried by a message channel. */
export interface MessageChannelTypes<TPayload, TKey> {
  readonly payload: TPayload;
  readonly key: TKey;
}

/** Argument tuple required when deriving a message id from a channel key. */
export type MessageChannelKeyArgs<TKey> = [void] extends [TKey] ? [key?: TKey] : [key: TKey];

/** Configuration for defining a typed message channel. */
export interface MessageChannelConfig<TKey = void, TSchema extends Schema | undefined = undefined> {
  readonly name: string;
  readonly schema?: TSchema;
  readonly resolveMessageId?: (...args: MessageChannelKeyArgs<TKey>) => MessageId;
}

/** Options for sending a concrete message id to a workflow run. */
export interface SendMessageOptions {
  readonly messageId: MessageId;
  readonly payload?: unknown;
  readonly idempotencyKey?: string;
}

/** Options for sending through a typed message channel. */
export interface SendMessageChannelOptions<TPayload = unknown, TKey = void> {
  readonly key?: TKey;
  readonly payload?: TPayload;
  readonly idempotencyKey?: string;
}

/** Object form for sending through a typed message channel. */
export interface SendMessageChannelObject<
  TPayload = unknown,
  TKey = void,
> extends SendMessageChannelOptions<TPayload, TKey> {
  readonly channel: MessageChannel<TPayload, TKey>;
}

/** Accepted input forms for sending a message to one run. */
export type SendMessageInput = SendMessageOptions | SendMessageChannelObject;

/** Options for broadcasting a concrete message id to matching runs. */
export interface BroadcastMessageOptions extends SendMessageOptions {
  readonly payload?: unknown;
  readonly target?: WorkflowListRunsOptions;
}

/** Options for broadcasting through a typed message channel to matching runs. */
export interface BroadcastMessageChannelOptions<
  TPayload = unknown,
  TKey = void,
> extends SendMessageChannelOptions<TPayload, TKey> {
  readonly target?: WorkflowListRunsOptions;
}

/** Object form for broadcasting through a typed message channel. */
export interface BroadcastMessageChannelObject<
  TPayload = unknown,
  TKey = void,
> extends BroadcastMessageChannelOptions<TPayload, TKey> {
  readonly channel: MessageChannel<TPayload, TKey>;
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
export interface WaitForMessageChannelOptions<TKey = void> {
  readonly commandId?: string;
  readonly name?: string;
  readonly key?: TKey;
  readonly timeout?: Temporal.Duration;
}

/** Object form for waiting through a typed message channel. */
export interface WaitForMessageChannelObject<
  TKey = void,
> extends WaitForMessageChannelOptions<TKey> {
  readonly channel: MessageChannel<unknown, TKey>;
}

/** Accepted input forms for waiting on a workflow message. */
export type WaitForMessageInput<TSchema extends Schema | undefined = undefined> =
  | WaitForMessageOptions<TSchema>
  | WaitForMessageChannelObject;
