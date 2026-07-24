import { validateStandardSchema, type Schema, type SchemaOutput } from "@temelj/standard-schema";

import type {
  WorkflowDefinition,
  WorkflowDefinitionConfig,
  WorkflowHandler,
  WorkflowImplementation,
  WorkflowInputFromSchema,
  WorkflowRawInputFromSchema,
  WorkflowStartTarget,
} from "./types/definition.ts";
import type {
  SendMessageChannelOptions,
  MessageChannel,
  MessageChannelConfig,
  MessageChannelKeyArgs,
  WaitForMessageChannelOptions,
  MessageId,
} from "./types/message.ts";

/** Defines a durable workflow definition. */
export function defineWorkflow<TInput = unknown, TOutput = unknown, TRawInput = TInput>(
  config: WorkflowDefinitionConfig,
): WorkflowDefinition<TInput, TOutput, TRawInput>;

/** Defines a durable workflow definition. */
export function defineWorkflow<const TSchema extends Schema, TOutput = unknown>(
  config: WorkflowDefinitionConfig<TSchema>,
): WorkflowDefinition<SchemaOutput<TSchema>, TOutput, WorkflowRawInputFromSchema<TSchema, never>>;

/** Defines a durable workflow definition. */
export function defineWorkflow<
  TInput = unknown,
  TOutput = unknown,
  TRawInput = TInput,
  const TSchema extends Schema | undefined = undefined,
>(
  config: WorkflowDefinitionConfig<TSchema>,
): WorkflowDefinition<
  WorkflowInputFromSchema<TSchema, TInput>,
  TOutput,
  WorkflowRawInputFromSchema<TSchema, TRawInput>
> {
  return {
    kind: "definition",
    config,
    name: config.name,
    ...(config.version === undefined ? {} : { version: config.version }),
  };
}

/** Creates a workflow definition from a resolved name and optional version. */
export function defineWorkflowFromName<TInput = unknown, TOutput = unknown, TRawInput = TInput>(
  name: string,
  version?: string,
): WorkflowDefinition<TInput, TOutput, TRawInput> {
  return defineWorkflow<TInput, TOutput, TRawInput>({
    name,
    ...(version === undefined ? {} : { version }),
  });
}

/** Returns the durable definition for a workflow definition or implementation. */
export function defineWorkflowFromTarget<TInput, TOutput, TRawInput>(
  target: WorkflowStartTarget<TInput, TOutput, TRawInput>,
): WorkflowDefinition<TInput, TOutput, TRawInput> {
  return target.kind === "implementation" ? target.definition : target;
}

/** Defines an executable workflow implementation from durable workflow config. */
export function implementWorkflow<TInput = unknown, TOutput = unknown, TRawInput = TInput>(
  config: WorkflowDefinitionConfig,
  handler: WorkflowHandler<TInput, TOutput>,
): WorkflowImplementation<TInput, TOutput, TRawInput>;

/** Defines an executable workflow implementation from durable workflow config. */
export function implementWorkflow<const TSchema extends Schema, TOutput = unknown>(
  config: WorkflowDefinitionConfig<TSchema>,
  handler: WorkflowHandler<SchemaOutput<TSchema>, TOutput>,
): WorkflowImplementation<
  SchemaOutput<TSchema>,
  TOutput,
  WorkflowRawInputFromSchema<TSchema, never>
>;

/** Defines an executable workflow implementation from durable workflow config. */
export function implementWorkflow<
  TInput = unknown,
  TOutput = unknown,
  TRawInput = TInput,
  const TSchema extends Schema | undefined = undefined,
>(
  config: WorkflowDefinitionConfig<TSchema>,
  handler: WorkflowHandler<WorkflowInputFromSchema<TSchema, TInput>, TOutput>,
): WorkflowImplementation<
  WorkflowInputFromSchema<TSchema, TInput>,
  TOutput,
  WorkflowRawInputFromSchema<TSchema, TRawInput>
> {
  const definition: WorkflowDefinition<
    WorkflowInputFromSchema<TSchema, TInput>,
    TOutput,
    WorkflowRawInputFromSchema<TSchema, TRawInput>
  > = {
    kind: "definition",
    config,
    name: config.name,
    ...(config.version === undefined ? {} : { version: config.version }),
  };
  return {
    kind: "implementation",
    definition,
    config: definition.config,
    name: definition.name,
    ...(definition.version === undefined ? {} : { version: definition.version }),
    handler,
  };
}

/** Defines workflow message channel for durable workflow use. */
export function defineMessageChannel<
  TPayload = unknown,
  TKey = void,
  const TSchema extends Schema | undefined = undefined,
>(
  config: MessageChannelConfig<TKey, TSchema>,
): MessageChannel<WorkflowInputFromSchema<TSchema, TPayload>, TKey> {
  const name = config.name;

  return {
    name,
    ...(config.schema === undefined ? {} : { schema: config.schema }),
    resolveMessageId: (...args: MessageChannelKeyArgs<TKey>) => {
      const messageId = config.resolveMessageId?.(...args) ?? name;
      return messageId;
    },
  };
}

/** Normalizes and parses workflow message channel send. */
export async function resolveMessageChannelSend<TPayload, TKey>(
  channel: MessageChannel<TPayload, TKey>,
  options: SendMessageChannelOptions<TPayload, TKey> = {},
): Promise<{
  readonly messageId: MessageId;
  readonly payload?: TPayload;
  readonly idempotencyKey?: string;
}> {
  const payload =
    channel.schema === undefined
      ? options.payload
      : ((await validateStandardSchema(
          channel.schema,
          options.payload,
          "Workflow message validation failed",
        )) as TPayload);
  return {
    messageId: resolveMessageChannelMessageId(channel, options.key),
    ...(payload === undefined ? {} : { payload }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
  };
}

/** Normalizes and parses workflow message channel wait. */
export function resolveMessageChannelWait<TKey>(
  channel: MessageChannel<unknown, TKey>,
  options: WaitForMessageChannelOptions<TKey> = {},
) {
  return {
    commandId: options.commandId ?? options.name ?? channel.name,
    name: options.name ?? channel.name,
    messageId: resolveMessageChannelMessageId(channel, options.key),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(channel.schema === undefined ? {} : { schema: channel.schema }),
  };
}

function resolveMessageChannelMessageId<TKey>(
  channel: MessageChannel<unknown, TKey>,
  key: TKey | undefined,
): string {
  return channel.resolveMessageId(...workflowMessageChannelKeyArgs(key));
}

function workflowMessageChannelKeyArgs<TKey>(key: TKey | undefined): MessageChannelKeyArgs<TKey> {
  // TKey decides whether the channel resolver accepts an optional or required tuple.
  return (key === undefined ? [] : [key]) as MessageChannelKeyArgs<TKey>;
}

/** Parses raw workflow input against the definition schema when one is configured. */
export async function parseWorkflowInput<TInput>(
  definition: WorkflowDefinition<TInput, unknown, unknown>,
  input: unknown,
): Promise<TInput> {
  const schema = definition.config.schema;
  if (schema === undefined) {
    return input as TInput;
  }
  return (await validateStandardSchema(
    schema,
    input,
    "Workflow input validation failed",
  )) as TInput;
}
