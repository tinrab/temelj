import type { Logger } from "@temelj/log";
import type { Schema, SchemaOutput } from "@temelj/standard-schema";
import type { StorageValue } from "@temelj/storage";

import type { StartTarget } from "./definition.ts";
import type { CreateHookOptions, CreateWebhookOptions, Hook, Webhook } from "./hook.ts";
import type { LockRecord, StepAcquireLockOptions, StepReleaseLockOptions } from "./lock.ts";
import type {
  MessageChannel,
  WaitForMessageChannelOptions,
  WaitForMessageOptions,
  MessageSender,
} from "./message.ts";
import type { ResolvedRetryConfig, RetryConfig } from "./retry.ts";
import type { AttributePatch, MaterializedStepType } from "./run.ts";
import type { CreateStreamOptions, Stream } from "./stream.ts";
/** Durable commands available inside a workflow handler. */

export interface StepApi extends StepTaskApi {
  /** Scoped operational logger for workflow orchestration code. */
  readonly log: Logger;
  /** Durable child-workflow start and run commands. */
  readonly workflow: StepWorkflowApi;
  /** Durable message send and wait commands. */
  readonly message: StepMessageApi;
  /** Durable lock acquire, release, and scoped lock commands. */
  readonly lock: StepLockApi;
  /** Commands that persist workflow run metadata and attributes. */
  readonly runData: StepRunDataApi;
  /** Replay-safe time, random, ID, and byte sources. */
  readonly deterministic: DeterministicApi;
  /** Durable stream creation commands. */
  readonly stream: StepStreamApi;
  /** External resume hook and webhook creation commands. */
  readonly hook: StepHookApi;
}

/** Inline tasks, reusable steps, and sleeps. */
export interface StepTaskApi {
  /** Runs an inline durable task and records the callback result for replay. */
  run<TOutput>(
    config: StepRunConfig,
    callback: (context: WorkflowStepContext) => Promise<TOutput> | TOutput,
  ): Promise<TOutput>;
  /** Calls a reusable step definition with typed arguments. */
  call<const TArgs extends readonly unknown[], TOutput>(
    definition: StepDefinition<TArgs, TOutput>,
    ...args: TArgs
  ): Promise<TOutput>;
  /** Pauses workflow execution for a durable duration. */
  sleep(commandId: string, duration: Temporal.Duration): Promise<void>;
  /** Pauses workflow execution until a durable instant. */
  sleepUntil(commandId: string, timestamp: Temporal.Instant): Promise<void>;
}

/** Durable child-workflow commands available inside a workflow handler. */
export interface StepWorkflowApi {
  /** Starts a child workflow and waits for its result. */
  run<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: StepRunWorkflowOptions,
  ): Promise<TOutput>;
  /** Starts a child workflow without waiting for it to finish and returns its run ID. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: StepStartWorkflowOptions,
  ): Promise<string>;
}

/** Durable message send and wait commands available inside a workflow handler. */
export interface StepMessageApi extends MessageSender {
  /** Waits for a named message and returns its payload. */
  wait(options: WaitForMessageOptions): Promise<StorageValue | undefined>;
  /** Waits for a named message and validates its payload with the configured schema. */
  wait<const TSchema extends Schema>(
    options: WaitForMessageOptions<TSchema> & { readonly schema: TSchema },
  ): Promise<SchemaOutput<TSchema>>;
  /** Waits for a message through a typed message channel. */
  wait<TPayload>(
    channel: MessageChannel<TPayload, unknown>,
    options?: WaitForMessageChannelOptions,
  ): Promise<TPayload>;
}

/** Durable lock commands available inside a workflow handler. */
export interface StepLockApi {
  /** Acquires a workflow lock and records the fencing token in history. */
  acquire(commandId: string, key: string, options: StepAcquireLockOptions): Promise<LockRecord>;
  /** Releases a workflow lock held by this workflow. */
  release(commandId: string, key: string, options?: StepReleaseLockOptions): Promise<LockRecord>;
  /** Acquires a workflow lock, runs a callback, and releases the lock afterward. */
  with<TOutput>(
    commandId: string,
    key: string,
    options: StepAcquireLockOptions,
    callback: (lock: LockRecord) => Promise<TOutput> | TOutput,
  ): Promise<TOutput>;
}

/** Durable run metadata and attribute update commands available inside a workflow handler. */
export interface StepRunDataApi {
  setMetadata(commandId: string, metadata: StorageValue): Promise<void>;
  /** Applies a workflow run attribute patch. */
  setAttributes(commandId: string, attributes: AttributePatch): Promise<void>;
}

/** Replay-safe sources for time, randomness, generated IDs, and bytes inside a workflow handler. */
export interface DeterministicApi {
  /** Returns the current instant, recording it once so replay sees the same value. */
  now(commandId?: string): Promise<Temporal.Instant>;
  /** Returns a random number in [0, 1), recording it once so replay sees the same value. */
  random(commandId?: string): Promise<number>;
  /** Returns an engine-generated recorded ID for the command. */
  recordedId(commandId?: string): Promise<string>;
  id(commandId?: string): Promise<string>;
  /** Returns a random UUID, recording it once so replay sees the same value. */
  uuid(commandId?: string): Promise<string>;
  /** Returns recorded random bytes with the requested length. */
  bytes(commandId: string, length: number): Promise<Uint8Array>;
}

/** Durable stream creation commands available inside a workflow handler. */
export interface StepStreamApi {
  /** Creates a durable stream that can be read while the workflow is running. */
  create<TChunk = unknown>(commandId: string, options?: CreateStreamOptions): Stream<TChunk>;
}

/** External resume token commands available inside a workflow handler. */
export interface StepHookApi {
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

/** Configuration for a single durable task command or reusable step definition. */
export interface StepRunConfig {
  readonly name?: string;
  readonly commandId?: string;
  readonly retry?: RetryConfig;
  readonly timeout?: Temporal.Duration;
}

/** Handler signature for reusable durable step definitions. */
export type StepDefinitionHandler<TArgs extends readonly unknown[], TOutput> = (
  context: WorkflowStepContext,
  ...args: TArgs
) => Promise<TOutput> | TOutput;

/** Reusable named durable task that can be called from workflow handlers. */
export interface StepDefinition<
  TArgs extends readonly unknown[] = readonly unknown[],
  TOutput = unknown,
> {
  /** Runtime configuration used when the reusable step is called. */
  readonly config: StepRunConfig;
  /** Durable command name used as the step identity by default. */
  readonly name: string;
  /** Handler invoked when the step is first executed. */
  readonly handler: StepDefinitionHandler<TArgs, TOutput>;
  /** Compile-time type markers for arguments and output. */
  readonly types?: StepDefinitionTypes<TArgs, TOutput>;
}

/** Compile-time type markers carried by a reusable step definition. */
export interface StepDefinitionTypes<TArgs extends readonly unknown[], TOutput> {
  /** Argument tuple accepted by the step handler after the context parameter. */
  readonly args: TArgs;
  /** Awaited output returned by the step handler. */
  readonly output: TOutput;
}

/** Options for running a child workflow and waiting for its result from a durable step. */
export interface StepRunWorkflowOptions extends StepStartWorkflowOptions {
  readonly timeout?: Temporal.Duration;
  readonly pollInterval?: Temporal.Duration;
  readonly retry?: RetryConfig;
}

/** Options for starting a child workflow in the background from a durable step. */
export interface StepStartWorkflowOptions {
  readonly commandId?: string;
  readonly name?: string;
  readonly id?: string;
  readonly idempotencyKey?: string;
  readonly cancellation?: ChildWorkflowCancellationPolicy;
}

/** Controls whether child workflow runs are canceled when their parent run is canceled. */
export type ChildWorkflowCancellationPolicy = "cascade" | "detach";

/** Context passed to a durable task attempt. */
export interface WorkflowStepContext {
  /** Stable identity and encounter count for this durable command. */
  readonly step: StepMetadata;
  /** Current attempt number for retryable durable work. */
  readonly attempt: number;
  /** Resolved retry configuration for this attempt. */
  readonly config: ResolvedRetryConfig;
  /** Abort signal for cancellation or timeout of this attempt. */
  readonly signal: AbortSignal;
  /** Scoped operational logger for this durable task attempt. */
  readonly log: Logger;
}

/** Identity and encounter metadata for a durable task attempt. */
export interface StepMetadata {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly kind: MaterializedStepType;
}
