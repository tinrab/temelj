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
import type { WorkflowStepMessageApi } from "./types/step.ts";

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

    const summary: Awaited<Promise<BroadcastMessageOptions>> = { ...send };

    if (messageInput.target !== undefined) {
      Object.assign(summary, { target: messageInput.target });
    }

    return summary;
  }

  const send = await resolveMessageChannelSend(messageInput, channelOptions);

  const result1: Awaited<Promise<BroadcastMessageOptions>> = { ...send };

  if (channelOptions?.target !== undefined) {
    Object.assign(result1, { target: channelOptions.target } satisfies Partial<
      Awaited<Promise<BroadcastMessageOptions>>
    >);
  }

  return result1;
}

interface WorkflowMessageWaitExecutor {
  <TPayload>(
    options: WaitForMessageOptions<Schema<unknown, TPayload> | undefined>,
  ): Promise<TPayload | StorageValue | undefined>;
}

/** Dispatches raw and schema-validated waits without erasing the schema output type. */
export function createWorkflowMessageWait(
  execute: WorkflowMessageWaitExecutor,
): WorkflowStepMessageApi["wait"] {
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
