import type { Schema } from "@temelj/standard-schema";
import type { StorageValue } from "@temelj/storage";

import type {
  BroadcastMessageChannelOptions,
  BroadcastMessageOptions,
  BroadcastMessageInput,
  SendMessageChannelOptions,
  SendMessageInput,
  SendMessageOptions,
  MessageChannel,
  WaitForMessageChannelOptions,
  WaitForMessageOptions,
} from "./types/message.ts";
import type { StepMessageApi } from "./types/step.ts";

import { resolveMessageChannelSend, resolveMessageChannelWait } from "./definition.ts";

export async function resolveSendMessageInput<TPayload, TRawPayload>(
  messageInput: SendMessageInput | MessageChannel<TPayload, TRawPayload>,
  channelOptions: SendMessageChannelOptions<TRawPayload> | undefined,
): Promise<SendMessageOptions> {
  if ("messageId" in messageInput) {
    return messageInput;
  }

  if ("channel" in messageInput) {
    return await resolveMessageChannelSend(messageInput.channel, messageInput);
  }

  return await resolveMessageChannelSend(messageInput, channelOptions);
}

export async function resolveBroadcastMessageInput<TPayload, TRawPayload>(
  messageInput: BroadcastMessageInput | MessageChannel<TPayload, TRawPayload>,
  channelOptions: BroadcastMessageChannelOptions<TRawPayload> | undefined,
): Promise<BroadcastMessageOptions> {
  if ("messageId" in messageInput) {
    return messageInput;
  }

  if ("channel" in messageInput) {
    const send = await resolveMessageChannelSend(messageInput.channel, messageInput);

    return {
      ...send,
      target: messageInput.target,
    };
  }

  const send = await resolveMessageChannelSend(messageInput, channelOptions);

  return {
    ...send,
    target: channelOptions?.target,
  };
}

interface MessageWaitExecutor {
  <TPayload>(
    options: WaitForMessageOptions<Schema<unknown, TPayload> | undefined>,
  ): Promise<TPayload | StorageValue | undefined>;
}

/** Dispatches raw and schema-validated waits without erasing the schema output type. */
export function createMessageWait(execute: MessageWaitExecutor): StepMessageApi["wait"] {
  function wait(options: WaitForMessageOptions): Promise<StorageValue | undefined>;
  function wait<TPayload>(
    options: WaitForMessageOptions<Schema<unknown, TPayload>> & {
      readonly schema: Schema<unknown, TPayload>;
    },
  ): Promise<TPayload>;
  function wait<TPayload>(
    channel: MessageChannel<TPayload, unknown>,
    options?: WaitForMessageChannelOptions,
  ): Promise<TPayload>;
  async function wait<TPayload>(
    input:
      | WaitForMessageOptions<Schema<unknown, TPayload> | undefined>
      | MessageChannel<TPayload, unknown>,
    options?: WaitForMessageChannelOptions,
  ): Promise<TPayload | StorageValue | undefined> {
    return await execute("messageId" in input ? input : resolveMessageChannelWait(input, options));
  }

  return wait;
}
