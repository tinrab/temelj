import type { Logger } from "@temelj/log";
import type { Schema, SchemaOutput } from "@temelj/standard-schema";

import type { WorkflowRetryConfig } from "./retry.ts";
import type { WorkflowDeterministicApi, WorkflowStepApi } from "./step.ts";

/** Configuration used to name, version, validate, and retry a workflow definition. */
export interface WorkflowDefinitionConfig<TSchema extends Schema | undefined = undefined> {
  readonly name: string;
  readonly version?: string;
  readonly schema?: TSchema;
  readonly retry?: WorkflowRetryConfig;
}

/** Infers the parsed workflow input type from a schema, falling back when no schema is present. */
export type WorkflowInputFromSchema<
  TSchema extends Schema | undefined,
  TFallback,
> = TSchema extends Schema ? SchemaOutput<TSchema> : TFallback;

/** Infers the raw workflow input accepted before schema parsing, falling back when no schema is present. */
export type WorkflowRawInputFromSchema<TSchema extends Schema | undefined, TFallback> =
  TSchema extends Schema<infer TInput, unknown> ? TInput : TFallback;

/** Durable workflow contract identified by name, optional version, and typed input/output markers. */
export interface WorkflowDefinition<TInput = unknown, TOutput = unknown, TRawInput = TInput> {
  readonly kind: "definition";
  readonly config: WorkflowDefinitionConfig<Schema | undefined>;
  readonly name: string;
  readonly version?: string;
  readonly types?: WorkflowDefinitionTypes<TInput, TOutput, TRawInput>;
}

/** Compile-time type markers carried by workflow definitions without affecting runtime behavior. */
export interface WorkflowDefinitionTypes<TInput, TOutput, TRawInput> {
  /** Parsed input type received by the workflow handler. */
  readonly input: TInput;
  /** Output type returned by the workflow handler. */
  readonly output: TOutput;
  /** Raw input type accepted before schema validation. */
  readonly rawInput: TRawInput;
}

/** Executable workflow implementation that binds a durable definition to a handler. */
export interface WorkflowImplementation<TInput = unknown, TOutput = unknown, TRawInput = TInput> {
  readonly kind: "implementation";
  readonly definition: WorkflowDefinition<TInput, TOutput, TRawInput>;
  readonly config: WorkflowDefinitionConfig<Schema | undefined>;
  readonly name: string;
  readonly version?: string;
  readonly handler: WorkflowHandler<TInput, TOutput>;
}

/** Function that runs workflow logic with a replay-safe workflow context. */
export type WorkflowHandler<TInput, TOutput> = (
  context: WorkflowContext<TInput>,
) => Promise<TOutput> | TOutput;

/** Context passed to a workflow handler during execution and replay. */
export interface WorkflowContext<TInput> {
  /** Parsed workflow input for the current run. */
  readonly input: TInput;
  /** Durable command API for workflow code. */
  readonly step: WorkflowStepApi;
  /** Replay-safe time, random, ID, and byte sources for workflow orchestration code. */
  readonly deterministic: WorkflowDeterministicApi;
  /** Scoped operational logger for workflow orchestration code. */
  readonly log: Logger;
  /** Stable identity and creation metadata for the current run. */
  readonly run: WorkflowRunContext;
  /** Abort signal for workflow cancellation. */
  readonly signal: AbortSignal;
  /** Workflow version stored on the current run, if any. */
  readonly version: string | undefined;
}

/** Stable identity and creation metadata for the currently executing run. */
export interface WorkflowRunContext {
  readonly id: string;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly createdAt: Temporal.Instant;
}

/** Workflow target accepted by start and schedule APIs. */
export type WorkflowStartTarget<TInput = unknown, TOutput = unknown, TRawInput = TInput> =
  | WorkflowDefinition<TInput, TOutput, TRawInput>
  | WorkflowImplementation<TInput, TOutput, TRawInput>;

/** Registry surface required by clients, workers, and runtimes. */
export interface RegistryLike {
  /** Creates and registers a workflow implementation. */
  implementWorkflow<TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput>;
  /** Registers an existing workflow implementation. */
  register<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void;
  /** Returns the implementation registered for a definition, if present. */
  get<TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> | undefined;
  /** Returns the implementation registered for a workflow name and optional version. */
  getByName(name: string, version?: string): WorkflowImplementation<unknown, unknown> | undefined;
  /** Returns the latest registered implementation for a workflow name. */
  latest(name: string): WorkflowImplementation<unknown, unknown> | undefined;
}

/** In-memory workflow registry contract. */
export interface Registry extends RegistryLike {
  /** Returns all registered workflow implementations. */
  entries(): readonly WorkflowImplementation<unknown, unknown>[];
  /** Returns the latest registered implementation for a workflow name. */
  latest(name: string): WorkflowImplementation<unknown, unknown> | undefined;
}
