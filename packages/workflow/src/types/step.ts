import type { Logger } from "@temelj/log";
import type { Schema, SchemaOutput } from "@temelj/standard-schema";

import { z } from "zod";

import type { WorkflowStartTarget } from "./definition.ts";
import type { CreateHookOptions, CreateWebhookOptions, Hook, Webhook } from "./hook.ts";
import type {
  LockRecord,
  WorkflowStepAcquireLockOptions,
  WorkflowStepReleaseLockOptions,
} from "./lock.ts";
import type {
  SendMessageChannelOptions,
  SendMessageOptions,
  MessageChannel,
  WaitForMessageChannelOptions,
  WaitForMessageOptions,
} from "./message.ts";
import type { WorkflowResolvedStepRetryConfig } from "./retry.ts";
import type { WorkflowRetryConfig } from "./retry.ts";
import type { RunId, WorkflowAttributePatch, WorkflowMaterializedStepType } from "./run.ts";
import type { CreateStreamOptions, Stream } from "./stream.ts";

export const workflowChildWorkflowCancellationPolicySchema = z.enum(["cascade", "detach"]);

export type { StepId } from "./step-id.ts";

/** Grouped durable commands available inside a workflow handler. */
export interface WorkflowStepApi {
  /** Scoped operational logger for workflow orchestration code. */
  readonly log: Logger;
  /** Durable task, reusable step, sleep, and sleep-until commands. */
  readonly task: WorkflowStepTaskApi;
  /** Durable child-workflow start and run commands. */
  readonly workflow: WorkflowStepWorkflowApi;
  /** Durable message send and wait commands. */
  readonly message: WorkflowStepMessageApi;
  /** Durable lock acquire, release, and scoped lock commands. */
  readonly lock: WorkflowStepLockApi;
  /** Commands that persist workflow run metadata and attributes. */
  readonly runData: WorkflowStepRunDataApi;
  /** Replay-safe time, random, ID, and byte sources. */
  readonly deterministic: WorkflowDeterministicApi;
  /** Durable stream creation commands. */
  readonly stream: WorkflowStepStreamApi;
  /** External resume hook and webhook creation commands. */
  readonly hook: WorkflowStepHookApi;
}

/** Durable task, reusable step, and sleep commands available inside a workflow handler. */
export interface WorkflowStepTaskApi {
  /** Runs an inline durable task and records the callback result for replay. */
  run<TOutput>(
    config: WorkflowStepRunConfig,
    callback: (context: WorkflowStepContext) => Promise<TOutput> | TOutput,
  ): Promise<TOutput>;
  /** Calls a reusable step definition with typed arguments. */
  call<const TArgs extends readonly unknown[], TOutput>(
    definition: WorkflowStepDefinition<TArgs, TOutput>,
    ...args: TArgs
  ): Promise<TOutput>;
  /** Pauses workflow execution for a durable duration. */
  sleep(commandId: string, duration: Temporal.Duration): Promise<void>;
  /** Pauses workflow execution until a durable instant. */
  sleepUntil(commandId: string, timestamp: Temporal.Instant): Promise<void>;
}

/** Durable child-workflow commands available inside a workflow handler. */
export interface WorkflowStepWorkflowApi {
  /** Starts a child workflow and waits for its result. */
  run<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowStepRunWorkflowOptions,
  ): Promise<TOutput>;
  /** Starts a child workflow without waiting for it to finish and returns its run ID. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowStepStartWorkflowOptions,
  ): Promise<string>;
}

/** Durable message send and wait commands available inside a workflow handler. */
export interface WorkflowStepMessageApi {
  /** Sends a named message to another workflow run. */
  send(runId: RunId, options: SendMessageOptions): Promise<void>;
  /** Sends a message through a typed message channel to another workflow run. */
  send<TPayload, TKey = void>(
    runId: RunId,
    channel: MessageChannel<TPayload, TKey>,
    options?: SendMessageChannelOptions<TPayload, TKey>,
  ): Promise<void>;
  /** Waits for a named message and returns its payload. */
  wait<TPayload = unknown>(options: WaitForMessageOptions): Promise<TPayload>;
  /** Waits for a named message and validates its payload with the configured schema. */
  wait<const TSchema extends Schema>(
    options: WaitForMessageOptions<TSchema>,
  ): Promise<SchemaOutput<TSchema>>;
  /** Waits for a message through a typed message channel. */
  wait<TPayload, TKey = void>(
    channel: MessageChannel<TPayload, TKey>,
    options?: WaitForMessageChannelOptions<TKey>,
  ): Promise<TPayload>;
}

/** Durable lock commands available inside a workflow handler. */
export interface WorkflowStepLockApi {
  /** Acquires a workflow lock and records the fencing token in history. */
  acquire(
    commandId: string,
    key: string,
    options: WorkflowStepAcquireLockOptions,
  ): Promise<LockRecord>;
  /** Releases a workflow lock held by this workflow. */
  release(
    commandId: string,
    key: string,
    options?: WorkflowStepReleaseLockOptions,
  ): Promise<LockRecord>;
  /** Acquires a workflow lock, runs a callback, and releases the lock afterward. */
  with<TOutput>(
    commandId: string,
    key: string,
    options: WorkflowStepAcquireLockOptions,
    callback: (lock: LockRecord) => Promise<TOutput> | TOutput,
  ): Promise<TOutput>;
}

/** Durable run metadata and attribute update commands available inside a workflow handler. */
export interface WorkflowStepRunDataApi {
  /** Replaces the workflow run metadata value. */
  setMetadata(commandId: string, metadata: unknown): Promise<void>;
  /** Applies a workflow run attribute patch. */
  setAttributes(commandId: string, attributes: WorkflowAttributePatch): Promise<void>;
}

/** Replay-safe sources for time, randomness, generated IDs, and bytes inside a workflow handler. */
export interface WorkflowDeterministicApi {
  /** Returns the current instant, recording it once so replay sees the same value. */
  now(commandId?: string): Promise<Temporal.Instant>;
  /** Returns a random number in [0, 1), recording it once so replay sees the same value. */
  random(commandId?: string): Promise<number>;
  /** Returns an engine-generated recorded ID for the command. */
  recordedId(commandId?: string): Promise<string>;
  /** Alias for recordedId. */
  id(commandId?: string): Promise<string>;
  /** Returns a random UUID, recording it once so replay sees the same value. */
  uuid(commandId?: string): Promise<string>;
  /** Returns recorded random bytes with the requested length. */
  bytes(commandId: string, length: number): Promise<Uint8Array>;
}

/** Compatibility alias for the deterministic API exposed on WorkflowStepApi. */
export type WorkflowStepDeterministicApi = WorkflowDeterministicApi;

/** Durable stream creation commands available inside a workflow handler. */
export interface WorkflowStepStreamApi {
  /** Creates a durable stream that can be read while the workflow is running. */
  create<TChunk = unknown>(commandId: string, options?: CreateStreamOptions): Stream<TChunk>;
}

/** External resume token commands available inside a workflow handler. */
export interface WorkflowStepHookApi {
  /** Creates a message-backed external resume hook. */
  create<TPayload = unknown>(options: CreateHookOptions): Hook<TPayload>;
  /** Creates a message-backed external resume hook with schema-validated payloads. */
  create<const TSchema extends Schema>(
    options: CreateHookOptions<TSchema>,
  ): Hook<SchemaOutput<TSchema>>;
  /** Creates a webhook-labeled external resume hook. */
  createWebhook<TPayload = unknown>(options: CreateWebhookOptions): Webhook<TPayload>;
  /** Creates a webhook-labeled external resume hook with schema-validated payloads. */
  createWebhook<const TSchema extends Schema>(
    options: CreateWebhookOptions<TSchema>,
  ): Webhook<SchemaOutput<TSchema>>;
}

/** Configuration for a single durable task command or reusable step definition. */
export interface WorkflowStepRunConfig {
  readonly name?: string;
  readonly commandId?: string;
  readonly retry?: WorkflowRetryConfig;
  readonly timeout?: Temporal.Duration;
}

/** Handler signature for reusable durable step definitions. */
export type WorkflowStepDefinitionHandler<TArgs extends readonly unknown[], TOutput> = (
  ...args: [...TArgs, WorkflowStepContext]
) => Promise<TOutput> | TOutput;

/** Reusable named durable task that can be called from workflow handlers. */
export interface WorkflowStepDefinition<
  TArgs extends readonly unknown[] = readonly unknown[],
  TOutput = unknown,
> {
  /** Runtime configuration used when the reusable step is called. */
  readonly config: WorkflowStepRunConfig;
  /** Durable command name used as the step identity by default. */
  readonly name: string;
  /** Handler invoked when the step is first executed. */
  readonly handler: WorkflowStepDefinitionHandler<TArgs, TOutput>;
  /** Compile-time type markers for arguments and output. */
  readonly types?: WorkflowStepDefinitionTypes<TArgs, TOutput>;
}

/** Compile-time type markers carried by a reusable step definition. */
export interface WorkflowStepDefinitionTypes<TArgs extends readonly unknown[], TOutput> {
  /** Argument tuple accepted by the step handler before the context parameter. */
  readonly args: TArgs;
  /** Awaited output returned by the step handler. */
  readonly output: TOutput;
}

/** Options for running a child workflow and waiting for its result from a durable step. */
export interface WorkflowStepRunWorkflowOptions extends WorkflowStepStartWorkflowOptions {
  readonly timeout?: Temporal.Duration;
  readonly pollInterval?: Temporal.Duration;
  readonly retry?: WorkflowRetryConfig;
}

/** Options for starting a child workflow in the background from a durable step. */
export interface WorkflowStepStartWorkflowOptions {
  readonly commandId?: string;
  readonly name?: string;
  readonly id?: string;
  readonly idempotencyKey?: string;
  readonly cancellation?: WorkflowChildWorkflowCancellationPolicy;
}

/** Controls whether child workflow runs are canceled when their parent run is canceled. */
export type WorkflowChildWorkflowCancellationPolicy = "cascade" | "detach";

/** Context passed to a durable task attempt. */
export interface WorkflowStepContext {
  /** Stable identity and encounter count for this durable command. */
  readonly step: WorkflowStepMetadata;
  /** Current attempt number for retryable durable work. */
  readonly attempt: number;
  /** Resolved retry configuration for this attempt. */
  readonly config: WorkflowResolvedStepRetryConfig;
  /** Abort signal for cancellation or timeout of this attempt. */
  readonly signal: AbortSignal;
  /** Scoped operational logger for this durable task attempt. */
  readonly log: Logger;
}

/** Identity and encounter metadata for a durable task attempt. */
export interface WorkflowStepMetadata {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly kind: WorkflowMaterializedStepType;
}
