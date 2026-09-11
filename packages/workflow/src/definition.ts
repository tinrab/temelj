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
  WaitForMessageChannelOptions,
  WaitForMessageOptions,
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
  const summary: WorkflowDefinition<
    WorkflowInputFromSchema<TSchema, TInput>,
    TOutput,
    WorkflowRawInputFromSchema<TSchema, TRawInput>
  > = { kind: "definition", config, name: config.name };

  if (config.version !== undefined) {
    Object.assign(summary, { version: config.version } satisfies Partial<
      WorkflowDefinition<
        WorkflowInputFromSchema<TSchema, TInput>,
        TOutput,
        WorkflowRawInputFromSchema<TSchema, TRawInput>
      >
    >);
  }

  return summary;
}

/** Creates a workflow definition from a resolved name and optional version. */
export function defineWorkflowFromName<TInput = unknown, TOutput = unknown, TRawInput = TInput>(
  name: string,
  version?: string,
): WorkflowDefinition<TInput, TOutput, TRawInput> {
  const config: WorkflowDefinitionConfig = { name };

  if (version !== undefined) {
    Object.assign(config, { version } satisfies Partial<WorkflowDefinitionConfig>);
  }

  return defineWorkflow<TInput, TOutput, TRawInput>(config);
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
  > = { kind: "definition", config, name: config.name };

  if (config.version !== undefined) {
    Object.assign(definition, { version: config.version } satisfies Partial<
      WorkflowDefinition<
        WorkflowInputFromSchema<TSchema, TInput>,
        TOutput,
        WorkflowRawInputFromSchema<TSchema, TRawInput>
      >
    >);
  }

  const result = {
    kind: "implementation",
    definition,
    config: definition.config,
    name: definition.name,
  } satisfies Partial<
    WorkflowImplementation<
      WorkflowInputFromSchema<TSchema, TInput>,
      TOutput,
      WorkflowRawInputFromSchema<TSchema, TRawInput>
    >
  >;

  if (definition.version !== undefined) {
    Object.assign(result, { version: definition.version } satisfies Partial<
      WorkflowImplementation<
        WorkflowInputFromSchema<TSchema, TInput>,
        TOutput,
        WorkflowRawInputFromSchema<TSchema, TRawInput>
      >
    >);
  }

  const result1 = Object.assign(result, { handler } satisfies Partial<
    WorkflowImplementation<
      WorkflowInputFromSchema<TSchema, TInput>,
      TOutput,
      WorkflowRawInputFromSchema<TSchema, TRawInput>
    >
  >);

  return result1;
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

  const result: ResolvedMessageChannelSend<TRawPayload> = {
    messageId: channel.name,
  };

  if (payload !== undefined) {
    Object.assign(result, { payload } satisfies Partial<ResolvedMessageChannelSend<TRawPayload>>);
  }

  if (options.idempotencyKey !== undefined) {
    Object.assign(result, { idempotencyKey: options.idempotencyKey } satisfies Partial<
      ResolvedMessageChannelSend<TRawPayload>
    >);
  }

  return result;
}

/** Normalizes and parses workflow message channel wait. */
export function resolveMessageChannelWait<TPayload>(
  channel: MessageChannel<TPayload, unknown>,
  options: WaitForMessageChannelOptions = {},
): WaitForMessageOptions<Schema<unknown, TPayload>> {
  const result = {
    commandId: options.commandId ?? options.name ?? channel.name,
    name: options.name ?? channel.name,
    messageId: channel.name,
  } satisfies Partial<WaitForMessageOptions<Schema<unknown, TPayload>>>;

  if (options.timeout !== undefined) {
    Object.assign(result, { timeout: options.timeout } satisfies Partial<
      WaitForMessageOptions<Schema<unknown, TPayload>>
    >);
  }

  const result1 = Object.assign(result, { schema: channel.schema } satisfies Partial<
    WaitForMessageOptions<Schema<unknown, TPayload>>
  >);

  return result1;
}
