import type { Schema } from "@temelj/standard-schema";

import type {
  BroadcastMessageChannelOptions,
  BroadcastMessageOptions,
  BroadcastMessageInput,
  SendMessageChannelOptions,
  SendMessageInput,
  SendMessageOptions,
  MessageChannel,
  WaitForMessageChannelOptions,
  WaitForMessageInput,
  WaitForMessageOptions,
} from "./types/message.ts";

import { resolveMessageChannelSend, resolveMessageChannelWait } from "./definition.ts";

export async function resolveSendMessageInput<TPayload, TKey>(
  messageInput: SendMessageInput | MessageChannel<TPayload, TKey>,
  channelOptions: SendMessageChannelOptions<TPayload, TKey> | undefined,
): Promise<SendMessageOptions> {
  if ("messageId" in messageInput) {
    return messageInput;
  }
  if ("channel" in messageInput) {
    return await resolveMessageChannelSend(messageInput.channel, messageInput);
  }
  return await resolveMessageChannelSend(messageInput, channelOptions);
}

export async function resolveBroadcastMessageInput<TPayload, TKey>(
  messageInput: BroadcastMessageInput | MessageChannel<TPayload, TKey>,
  channelOptions: BroadcastMessageChannelOptions<TPayload, TKey> | undefined,
): Promise<BroadcastMessageOptions> {
  if ("messageId" in messageInput) {
    return messageInput;
  }
  if ("channel" in messageInput) {
    const send = await resolveMessageChannelSend(messageInput.channel, messageInput);
    return {
      ...send,
      ...(messageInput.target === undefined ? {} : { target: messageInput.target }),
    };
  }
  const send = await resolveMessageChannelSend(messageInput, channelOptions);
  return {
    ...send,
    ...(channelOptions?.target === undefined ? {} : { target: channelOptions.target }),
  };
}

export function resolveWaitForMessageInput<TKey>(
  messageInput: WaitForMessageInput<Schema | undefined> | MessageChannel<unknown, TKey>,
  channelOptions: WaitForMessageChannelOptions<TKey> | undefined,
): WaitForMessageOptions<Schema | undefined> {
  if ("channel" in messageInput) {
    return resolveMessageChannelWait(messageInput.channel, messageInput);
  }
  if ("messageId" in messageInput) {
    return messageInput;
  }
  return resolveMessageChannelWait(messageInput, channelOptions);
}
