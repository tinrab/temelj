import { validateStandardSchema, type Schema, type SchemaOutput } from "@temelj/standard-schema";

import type {
  WorkflowDefinition,
  DefinitionConfig,
  WorkflowHandler,
  WorkflowImplementation,
  InputFromSchema,
  RawInputFromSchema,
  StartTarget,
} from "./types/definition.ts";
import type { MessageId } from "./types/ids.ts";
import type {
  SendMessageChannelOptions,
  MessageChannel,
  MessageChannelConfig,
  WaitForMessageChannelOptions,
  WaitForMessageOptions,
} from "./types/message.ts";

/** Defines a durable workflow definition. */
export function defineWorkflow<TInput = unknown, TOutput = unknown, TRawInput = TInput>(
  config: DefinitionConfig,
): WorkflowDefinition<TInput, TOutput, TRawInput>;

/** Defines a durable workflow definition. */
export function defineWorkflow<const TSchema extends Schema, TOutput = unknown>(
  config: DefinitionConfig<TSchema>,
): WorkflowDefinition<SchemaOutput<TSchema>, TOutput, RawInputFromSchema<TSchema, never>>;

/** Defines a durable workflow definition. */
export function defineWorkflow<
  TInput = unknown,
  TOutput = unknown,
  TRawInput = TInput,
  const TSchema extends Schema | undefined = undefined,
>(
  config: DefinitionConfig<TSchema>,
): WorkflowDefinition<
  InputFromSchema<TSchema, TInput>,
  TOutput,
  RawInputFromSchema<TSchema, TRawInput>
> {
  return {
    kind: "definition",
    config,
    name: config.name,
    version: config.version,
  };
}

/** Creates a workflow definition from a resolved name and optional version. */
export function defineFromName<TInput = unknown, TOutput = unknown, TRawInput = TInput>(
  name: string,
  version?: string,
): WorkflowDefinition<TInput, TOutput, TRawInput> {
  const config: DefinitionConfig = {
    name,
    version,
  };

  return defineWorkflow<TInput, TOutput, TRawInput>(config);
}

/** Returns the durable definition for a workflow definition or implementation. */
export function defineFromTarget<TInput, TOutput, TRawInput>(
  target: StartTarget<TInput, TOutput, TRawInput>,
): WorkflowDefinition<TInput, TOutput, TRawInput> {
  return target.kind === "implementation" ? target.definition : target;
}

/** Defines an executable workflow implementation from durable workflow config. */
export function implementWorkflow<TInput = unknown, TOutput = unknown, TRawInput = TInput>(
  config: DefinitionConfig,
  handler: WorkflowHandler<TInput, TOutput>,
): WorkflowImplementation<TInput, TOutput, TRawInput>;

/** Defines an executable workflow implementation from durable workflow config. */
export function implementWorkflow<const TSchema extends Schema, TOutput = unknown>(
  config: DefinitionConfig<TSchema>,
  handler: WorkflowHandler<SchemaOutput<TSchema>, TOutput>,
): WorkflowImplementation<SchemaOutput<TSchema>, TOutput, RawInputFromSchema<TSchema, never>>;

/** Defines an executable workflow implementation from durable workflow config. */
export function implementWorkflow<
  TInput = unknown,
  TOutput = unknown,
  TRawInput = TInput,
  const TSchema extends Schema | undefined = undefined,
>(
  config: DefinitionConfig<TSchema>,
  handler: WorkflowHandler<InputFromSchema<TSchema, TInput>, TOutput>,
): WorkflowImplementation<
  InputFromSchema<TSchema, TInput>,
  TOutput,
  RawInputFromSchema<TSchema, TRawInput>
> {
  const definition: WorkflowDefinition<
    InputFromSchema<TSchema, TInput>,
    TOutput,
    RawInputFromSchema<TSchema, TRawInput>
  > = {
    kind: "definition",
    config,
    name: config.name,
    version: config.version,
  };

  return {
    kind: "implementation",
    definition,
    config: definition.config,
    name: definition.name,
    version: definition.version,
    handler,
  };
}

/** Defines a message channel whose schema validates incoming payloads. */
export function defineMessageChannel<TPayload, TRawPayload = unknown>(
  config: MessageChannelConfig<TPayload, TRawPayload>,
): MessageChannel<TPayload, TRawPayload> {
  return {
    name: config.name,
    schema: config.schema,
  };
}

interface ResolvedMessageChannelSend<TPayload> {
  readonly messageId: MessageId;
  readonly payload?: TPayload;
  readonly idempotencyKey?: string;
}

/** Validates a channel send and preserves its raw payload for the receiving schema. */
export async function resolveMessageChannelSend<TPayload, TRawPayload>(
  channel: MessageChannel<TPayload, TRawPayload>,
  options: SendMessageChannelOptions<TRawPayload> = {},
): Promise<ResolvedMessageChannelSend<TRawPayload>> {
  const payload = options.payload;
  await validateStandardSchema(channel.schema, payload, "Workflow message validation failed");

  return {
    messageId: channel.name,
    payload,
    idempotencyKey: options.idempotencyKey,
  };
}

export function resolveMessageChannelWait<TPayload>(
  channel: MessageChannel<TPayload, unknown>,
  options: WaitForMessageChannelOptions = {},
): WaitForMessageOptions<Schema<unknown, TPayload>> {
  return {
    commandId: options.commandId ?? options.name ?? channel.name,
    name: options.name ?? channel.name,
    messageId: channel.name,
    timeout: options.timeout,
    schema: channel.schema,
  };
}
