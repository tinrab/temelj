import type { StorageValue } from "@temelj/storage";

import type { CompiledWorkflowFunction, WorkflowRunHandle } from "../types/client.ts";
import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  RegistryLike,
  WorkflowStartTarget,
} from "../types/definition.ts";
import type {
  SendMessageChannelOptions,
  SendMessageInput,
  MessageChannel,
} from "../types/message.ts";
import type { ResultOptions } from "../types/result.ts";
import type { WorkflowRunArguments, WorkflowStartOptions } from "../types/run-options.ts";
import type { RunId, WorkflowRunRecord, WorkflowRunStatus } from "../types/run.ts";
import type { WorkflowRuntime, WorkflowRuntimeRunsApi } from "../types/runtime.ts";
import type {
  CloudflareWorkflowBinding,
  CloudflareWorkflowInstance,
  CloudflareWorkflowInstanceStatus,
} from "./types.ts";

import { getCompiledWorkflowDefinition } from "../compiled-function.ts";
import { parseWorkflowInput } from "../definition.ts";
import {
  WorkflowCapabilityError,
  WorkflowDefinitionError,
  WorkflowResultTimeoutError,
  WorkflowRunCanceledError,
} from "../errors/mod.ts";
import { resolveSendMessageInput } from "../message-options.ts";
import { Registry } from "../registry.ts";
import { durationTotal } from "../utility.ts";
import {
  decodeCloudflareWorkflowValue,
  encodeCloudflareWorkflowValue,
  type CloudflareWorkflowEnvelope,
} from "./codec.ts";
import { makeCloudflareWorkflowEventType } from "./name.ts";
import { resolveCloudflareWorkflowImplementation } from "./registry.ts";

const DEFAULT_RESULT_POLL_INTERVAL = 100;
const CLOUDFLARE_INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;

export interface CreateCloudflareWorkflowRuntimeOptions {
  readonly binding: CloudflareWorkflowBinding;
  readonly registry?: RegistryLike;
  readonly resultPollInterval?: Temporal.Duration;
  /** Controls whether workflows absent from the initial registry may be registered at runtime. */
  readonly registration?: "dynamic" | "static";
}

export interface CloudflareWorkflowRuntimeRunsApi extends WorkflowRuntimeRunsApi {
  get<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    runId: RunId,
  ): Promise<WorkflowRunHandle<TOutput>>;
}

export interface CloudflareWorkflowMessagesApi {
  send(runId: RunId, options: SendMessageInput): Promise<void>;
  send<TPayload, TKey = void>(
    runId: RunId,
    channel: MessageChannel<TPayload, TKey>,
    options?: SendMessageChannelOptions<TPayload, TKey>,
  ): Promise<void>;
}

export interface CloudflareWorkflowRuntime extends WorkflowRuntime {
  readonly runs: CloudflareWorkflowRuntimeRunsApi;
  readonly messages: CloudflareWorkflowMessagesApi;
}

/** Creates a runtime facade over a generic Cloudflare Workflow binding. */
export function createCloudflareWorkflowRuntime(
  options: CreateCloudflareWorkflowRuntimeOptions,
): CloudflareWorkflowRuntime {
  return new CloudflareWorkflowRuntimeImpl(options);
}

class CloudflareWorkflowRuntimeImpl implements CloudflareWorkflowRuntime {
  readonly runs: CloudflareWorkflowRuntimeRunsApi;
  readonly messages: CloudflareWorkflowMessagesApi;
  readonly schedules = unsupportedApi<WorkflowRuntime["schedules"]>(
    "Cloudflare workflow schedules",
  );
  readonly locks = unsupportedApi<WorkflowRuntime["locks"]>("Cloudflare workflow locks");
  readonly workers = unsupportedApi<WorkflowRuntime["workers"]>("Cloudflare workflow workers");
  readonly #binding: CloudflareWorkflowBinding;
  readonly #registry: RegistryLike;
  readonly #registration: "dynamic" | "static";
  readonly #resultPollInterval: number;

  constructor(options: CreateCloudflareWorkflowRuntimeOptions) {
    this.#binding = options.binding;
    this.#registry = options.registry ?? new Registry();
    this.#registration = options.registration ?? "dynamic";
    this.#resultPollInterval =
      options.resultPollInterval === undefined
        ? DEFAULT_RESULT_POLL_INTERVAL
        : durationMilliseconds(options.resultPollInterval, "Cloudflare result poll interval");
    this.runs = {
      getHandle: async () =>
        WorkflowCapabilityError.unsupported(
          "Cloudflare run lookup without a workflow target; use runtime.runs.get(workflow, runId)",
        ),
      list: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow run listing"),
      get: async (workflow, runId) => this.#createHandle(workflow, runId),
    };
    this.messages = {
      send: async <TPayload, TKey = void>(
        runId: RunId,
        input: SendMessageInput | MessageChannel<TPayload, TKey>,
        channelOptions?: SendMessageChannelOptions<TPayload, TKey>,
      ) => {
        const message = await resolveSendMessageInput(input, channelOptions);
        const instance = await this.#binding.get(runId);
        await instance.sendEvent({
          type: makeCloudflareWorkflowEventType(message.messageId),
          payload: encodeCloudflareWorkflowValue(message.payload),
        });
      },
    };
  }

  async close(): Promise<void> {}

  implementWorkflow<TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> {
    if (this.#registration === "static") {
      const implementation = this.#registry.get(definition);
      if (implementation === undefined || implementation.handler !== handler) {
        WorkflowDefinitionError.implementationNotBundled(
          workflowImplementationKey(definition.name, definition.version),
        );
      }
      return implementation;
    }
    return this.#registry.implementWorkflow(definition, handler);
  }

  register<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void {
    if (this.#registry.get(implementation.definition) !== implementation) {
      if (this.#registration === "static") {
        WorkflowDefinitionError.implementationNotBundled(
          workflowImplementationKey(implementation.name, implementation.version),
        );
      }
      this.#registry.register(implementation);
    }
  }

  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowDefinition<TInput, TOutput, TRawInput>,
    ...args: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowImplementation<TInput, TOutput, TRawInput>,
    ...args: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  start<TArgs extends readonly unknown[], TOutput>(
    workflow: CompiledWorkflowFunction<TArgs, TOutput>,
    ...args: TArgs
  ): Promise<WorkflowRunHandle<Awaited<TOutput>>>;
  async start(workflow: unknown, ...args: unknown[]): Promise<WorkflowRunHandle<unknown>> {
    if (typeof workflow === "function") {
      const implementation = getCompiledWorkflowDefinition(
        workflow as (...args: never[]) => unknown,
      );
      if (implementation === undefined) {
        WorkflowDefinitionError.compiledMetadataMissing();
      }
      this.register(implementation);
      return await this.#startTarget(implementation, args, undefined);
    }
    const target = workflow as WorkflowStartTarget;
    if (target.kind === "implementation") {
      this.register(target);
    }
    return await this.#startTarget(target, args[0], args[1] as WorkflowStartOptions | undefined);
  }

  async #startTarget<TInput, TOutput, TRawInput>(
    target: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    rawInput: TRawInput,
    startOptions: WorkflowStartOptions | undefined,
  ): Promise<WorkflowRunHandle<TOutput>> {
    rejectUnsupportedStartOptions(startOptions);
    const requestedVersion = startOptions?.workflowVersion ?? target.version;
    const implementation = resolveCloudflareWorkflowImplementation(
      this.#registry,
      target.name,
      requestedVersion,
    );
    if (implementation.config.retry !== undefined) {
      WorkflowCapabilityError.unsupported("Cloudflare workflow-level retry configuration");
    }
    const input = await parseWorkflowInput(implementation.definition, rawInput);
    const envelope: CloudflareWorkflowEnvelope = {
      kind: "temelj-workflow",
      version: 1,
      workflowName: implementation.name,
      ...(implementation.version === undefined ? {} : { workflowVersion: implementation.version }),
      input: encodeCloudflareWorkflowValue(input),
    };
    const id = await resolveInstanceId(implementation.name, implementation.version, startOptions);
    const createdAt = Temporal.Now.instant();
    let instance: CloudflareWorkflowInstance;
    if (startOptions?.idempotencyKey === undefined) {
      instance = await this.#binding.create({
        ...(id === undefined ? {} : { id }),
        params: envelope,
      });
    } else {
      if (id === undefined) {
        throw new TypeError("Cloudflare idempotent workflow start requires a resolved instance id");
      }
      const instances = await this.#binding.createBatch([{ id, params: envelope }]);
      instance = instances[0] ?? (await this.#binding.get(id));
    }
    return this.#handle(
      implementation.definition as WorkflowDefinition<unknown, TOutput, unknown>,
      instance,
      createdAt,
    );
  }

  async #createHandle<TInput, TOutput, TRawInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    runId: RunId,
  ): Promise<WorkflowRunHandle<TOutput>> {
    const implementation = resolveCloudflareWorkflowImplementation(
      this.#registry,
      workflow.name,
      workflow.version,
    );
    const instance = await this.#binding.get(runId);
    return this.#handle(
      implementation.definition as WorkflowDefinition<unknown, TOutput, unknown>,
      instance,
      Temporal.Now.instant(),
    );
  }

  #handle<TOutput>(
    definition: WorkflowDefinition<unknown, TOutput, unknown>,
    instance: CloudflareWorkflowInstance,
    createdAt: Temporal.Instant,
  ): WorkflowRunHandle<TOutput> {
    const status = async () => await instance.status();
    const record = async (): Promise<WorkflowRunRecord> =>
      workflowRunRecord(definition, instance.id, createdAt, await status());
    return {
      runId: instance.id,
      workflowName: definition.name,
      ...(definition.version === undefined ? {} : { workflowVersion: definition.version }),
      getRun: record,
      status: async () => cloudflareRunStatus((await status()).status),
      events: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow event history"),
      timeline: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow timeline"),
      result: async (options) =>
        await cloudflareWorkflowResult<TOutput>(instance, options, this.#resultPollInterval),
      getStreamInfo: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow streams"),
      followStream: () => WorkflowCapabilityError.unsupported("Cloudflare workflow streams"),
      waitForStream: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow streams"),
      waitForStreamChunk: async () =>
        WorkflowCapabilityError.unsupported("Cloudflare workflow streams"),
      waitForStreamTerminal: async () =>
        WorkflowCapabilityError.unsupported("Cloudflare workflow streams"),
      readStream: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow streams"),
      readStreamPage: async () =>
        WorkflowCapabilityError.unsupported("Cloudflare workflow streams"),
      reschedule: async () =>
        WorkflowCapabilityError.unsupported("Cloudflare workflow rescheduling"),
      releaseStaleLease: async () =>
        WorkflowCapabilityError.unsupported("Cloudflare workflow worker leases"),
      retryFailed: async () =>
        WorkflowCapabilityError.unsupported("Cloudflare workflow manual retries"),
      markPermanentlyFailed: async () =>
        WorkflowCapabilityError.unsupported("Cloudflare permanent workflow failure"),
      setMetadata: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow metadata"),
      setAttributes: async () =>
        WorkflowCapabilityError.unsupported("Cloudflare workflow attributes"),
      async cancel() {
        const state = await instance.status();
        if (!isTerminalCloudflareStatus(state.status)) {
          await instance.terminate();
        }
        return await record();
      },
    };
  }
}

function workflowImplementationKey(name: string, version: string | undefined): string {
  return version === undefined ? name : `${name}@${version}`;
}

function isTerminalCloudflareStatus(status: CloudflareWorkflowInstanceStatus["status"]): boolean {
  return status === "complete" || status === "errored" || status === "terminated";
}

async function cloudflareWorkflowResult<TOutput>(
  instance: CloudflareWorkflowInstance,
  options: ResultOptions | undefined,
  defaultPollInterval: number,
): Promise<TOutput> {
  const pollInterval =
    options?.pollInterval === undefined
      ? defaultPollInterval
      : durationMilliseconds(options.pollInterval, "Cloudflare result poll interval");
  const timeout =
    options?.timeout === undefined
      ? undefined
      : durationMilliseconds(options.timeout, "Cloudflare result timeout");
  const startedAt = Date.now();
  while (true) {
    const state = await instance.status();
    if (state.status === "complete") {
      return decodeCloudflareWorkflowValue(
        state.output,
        `Cloudflare Workflow ${instance.id} output`,
      ) as TOutput;
    }
    if (state.status === "errored") {
      const error = new Error(state.error?.message ?? "Cloudflare Workflow failed");
      error.name = state.error?.name ?? "Error";
      throw error;
    }
    if (state.status === "terminated") {
      WorkflowRunCanceledError.canceled(instance.id);
    }
    if (state.status === "unknown") {
      throw new TypeError("Cloudflare Workflow returned an unknown instance status");
    }
    if (timeout !== undefined && Date.now() - startedAt >= timeout) {
      WorkflowResultTimeoutError.timedOut(
        instance.id,
        Temporal.Duration.from({ milliseconds: timeout }),
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
  }
}

function workflowRunRecord(
  definition: WorkflowDefinition,
  runId: string,
  createdAt: Temporal.Instant,
  state: CloudflareWorkflowInstanceStatus,
): WorkflowRunRecord {
  const now = Temporal.Now.instant();
  const status = cloudflareRunStatus(state.status);
  return {
    id: runId,
    namespace: "cloudflare",
    workflowName: definition.name,
    ...(definition.version === undefined ? {} : { workflowVersion: definition.version }),
    status,
    ...(state.status === "complete"
      ? {
          output: decodeCloudflareWorkflowValue(
            state.output,
            `Cloudflare Workflow ${runId} output`,
          ) as StorageValue,
        }
      : {}),
    ...(state.error === undefined
      ? {}
      : {
          error: {
            name: state.error.name,
            message: state.error.message,
          },
        }),
    createdAt,
    updatedAt: now,
    lastTransitionAt: now,
    lastTransitionReason:
      status === "completed"
        ? "completed"
        : status === "failed"
          ? "failed"
          : status === "canceled"
            ? "canceled"
            : status === "waiting"
              ? "waiting"
              : status === "running"
                ? "started"
                : "created",
    ...(status === "completed" || status === "failed" || status === "canceled"
      ? { finishedAt: now }
      : {}),
  };
}

function cloudflareRunStatus(
  status: CloudflareWorkflowInstanceStatus["status"],
): WorkflowRunStatus {
  switch (status) {
    case "queued":
      return "pending";
    case "running":
      return "running";
    case "waiting":
    case "paused":
    case "waitingForPause":
      return "waiting";
    case "complete":
      return "completed";
    case "errored":
      return "failed";
    case "terminated":
      return "canceled";
    case "unknown":
      throw new TypeError("Cloudflare Workflow returned an unknown instance status");
  }
}

async function resolveInstanceId(
  workflowName: string,
  workflowVersion: string | undefined,
  options: WorkflowStartOptions | undefined,
): Promise<string | undefined> {
  if (options?.id !== undefined) {
    validateInstanceId(options.id);
    return options.id;
  }
  if (options?.idempotencyKey === undefined) {
    return undefined;
  }
  const input = new TextEncoder().encode(
    `${workflowName}\0${workflowVersion ?? ""}\0${options.idempotencyKey}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  const id = `temelj-${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  validateInstanceId(id);
  return id;
}

function validateInstanceId(id: string): void {
  if (id.length > 100 || !CLOUDFLARE_INSTANCE_ID_PATTERN.test(id)) {
    throw new TypeError(
      "Cloudflare Workflow instance id must be at most 100 characters and contain only letters, digits, underscores, and hyphens",
    );
  }
}

function rejectUnsupportedStartOptions(options: WorkflowStartOptions | undefined): void {
  if (
    options?.availableAt !== undefined ||
    options?.deadlineAt !== undefined ||
    options?.context !== undefined ||
    options?.parent !== undefined ||
    options?.workflowVersionResolver !== undefined
  ) {
    WorkflowCapabilityError.unsupported(
      "Cloudflare start context, parent, delayed availability, deadline, or version resolver",
    );
  }
}

function durationMilliseconds(duration: Temporal.Duration, label: string): number {
  const milliseconds = durationTotal(duration);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new RangeError(`${label} must resolve to non-negative whole milliseconds`);
  }
  return milliseconds;
}

function unsupportedApi<T>(capability: string): T {
  return new Proxy(
    {},
    {
      get() {
        return () => WorkflowCapabilityError.unsupported(capability);
      },
    },
  ) as T;
}
