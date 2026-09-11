import { isFunction } from "@temelj/value";

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
import type { CloudflareWorkflowInstanceCreateOptions } from "./types.ts";
import type {
  CloudflareWorkflowBinding,
  CloudflareWorkflowInstance,
  CloudflareWorkflowInstanceStatus,
} from "./types.ts";

import { getCompiledWorkflowDefinition } from "../compiled-function.ts";
import { defineWorkflowFromTarget } from "../definition.ts";
import { parseWorkflowInput } from "../engine/serialization.ts";
import {
  WorkflowCapabilityError,
  WorkflowDefinitionError,
  WorkflowResultTimeoutError,
  WorkflowRunCanceledError,
} from "../errors/mod.ts";
import { resolveSendMessageInput } from "../message-options.ts";
import { Registry } from "../registry.ts";
import { durationTotal } from "../temporal.ts";
import {
  decodeCloudflareWorkflowResult,
  encodeCloudflareWorkflowValue,
  type CloudflareWorkflowEnvelope,
} from "./codec.ts";
import { makeCloudflareWorkflowEventType } from "./name.ts";

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
  send<TPayload, TRawPayload = TPayload>(
    runId: RunId,
    channel: MessageChannel<TPayload, TRawPayload>,
    options?: SendMessageChannelOptions<TRawPayload>,
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
  readonly schedules: WorkflowRuntime["schedules"] = {
    next: unsupportedSchedules,
    create: unsupportedSchedules,
    upsert: unsupportedSchedules,
    get: unsupportedSchedules,
    list: unsupportedSchedules,
    page: unsupportedSchedules,
    pause: unsupportedSchedules,
    resume: unsupportedSchedules,
    archive: unsupportedSchedules,
    delete: unsupportedSchedules,
    tick: unsupportedSchedules,
  };
  readonly locks: WorkflowRuntime["locks"] = {
    acquire: unsupportedLocks,
    get: unsupportedLocks,
    list: unsupportedLocks,
    release: unsupportedLocks,
    releaseStale: unsupportedLocks,
  };
  readonly workers: WorkflowRuntime["workers"] = {
    create: unsupportedWorkers,
    processRun: unsupportedWorkers,
    wakeDueRuns: unsupportedWorkers,
  };
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
      send: async <TPayload, TRawPayload = TPayload>(
        runId: RunId,
        input: SendMessageInput | MessageChannel<TPayload, TRawPayload>,
        channelOptions?: SendMessageChannelOptions<TRawPayload>,
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
  async start(
    workflow: WorkflowStartTarget | Function,
    ...args: unknown[]
  ): Promise<WorkflowRunHandle<unknown>> {
    if (isFunction(workflow)) {
      const implementation = getCompiledWorkflowDefinition(workflow);

      if (implementation === undefined) {
        WorkflowDefinitionError.compiledMetadataMissing();
      }

      this.register(implementation);

      return await this.#startTarget(implementation, args, undefined);
    }

    // SAFETY: The function overload was handled above. Both remaining overloads place WorkflowStartOptions in the second argument.
    const [input, options] = args as [unknown, WorkflowStartOptions?];

    if (workflow.kind === "implementation") {
      this.register(workflow);
    }

    return await this.#startTarget(workflow, input, options);
  }

  async #startTarget<TInput, TOutput, TRawInput>(
    target: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    rawInput: TRawInput,
    startOptions: WorkflowStartOptions | undefined,
  ): Promise<WorkflowRunHandle<TOutput>> {
    rejectUnsupportedStartOptions(startOptions);

    if (
      startOptions?.workflowVersion !== undefined &&
      startOptions.workflowVersion !== target.version
    ) {
      WorkflowDefinitionError.versionMismatch("Cloudflare start target");
    }

    const implementation = this.#registeredImplementation(target);

    if (implementation.config.retry !== undefined) {
      WorkflowCapabilityError.unsupported("Cloudflare workflow-level retry configuration");
    }

    await parseWorkflowInput(implementation.definition, rawInput);

    const result = {
      kind: "temelj-workflow",
      version: 1,
      workflowName: implementation.name,
    } satisfies Partial<CloudflareWorkflowEnvelope>;

    if (implementation.version !== undefined) {
      Object.assign(result, {
        workflowVersion: implementation.version,
      } satisfies Partial<CloudflareWorkflowEnvelope>);
    }

    const result1 = Object.assign(result, {
      input: encodeCloudflareWorkflowValue(rawInput),
    } satisfies Partial<CloudflareWorkflowEnvelope>);

    const envelope: CloudflareWorkflowEnvelope = result1;

    const id = await resolveInstanceId(implementation.name, implementation.version, startOptions);
    const createdAt = Temporal.Now.instant();
    let instance: CloudflareWorkflowInstance;

    if (startOptions?.idempotencyKey === undefined) {
      const result2 = {} satisfies Partial<CloudflareWorkflowInstanceCreateOptions>;

      if (id !== undefined) {
        Object.assign(result2, { id } satisfies Partial<CloudflareWorkflowInstanceCreateOptions>);
      }

      const result3 = Object.assign(result2, {
        params: envelope,
      } satisfies Partial<CloudflareWorkflowInstanceCreateOptions>);

      const createOptions: CloudflareWorkflowInstanceCreateOptions = result3;
      instance = await this.#binding.create(createOptions);
    } else {
      if (id === undefined) {
        throw new TypeError("Cloudflare idempotent workflow start requires a resolved instance id");
      }

      const instances = await this.#binding.createBatch([{ id, params: envelope }]);
      instance = instances[0] ?? (await this.#binding.get(id));
    }

    return this.#handle(implementation.definition, instance, createdAt);
  }

  async #createHandle<TInput, TOutput, TRawInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    runId: RunId,
  ): Promise<WorkflowRunHandle<TOutput>> {
    const implementation = this.#registeredImplementation(workflow);

    const instance = await this.#binding.get(runId);

    return this.#handle(implementation.definition, instance, Temporal.Now.instant());
  }

  #registeredImplementation<TInput, TOutput, TRawInput>(
    target: WorkflowStartTarget<TInput, TOutput, TRawInput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> {
    const implementation = this.#registry.get(defineWorkflowFromTarget(target));

    if (implementation === undefined) {
      throw new TypeError(
        "Cloudflare Workflow target must use its registered definition: " + target.name,
      );
    }

    return implementation;
  }

  #handle<TOutput>(
    definition: WorkflowDefinition<unknown, TOutput, unknown>,
    instance: CloudflareWorkflowInstance,
    createdAt: Temporal.Instant,
  ): WorkflowRunHandle<TOutput> {
    const status = async () => await instance.status();

    const record = async (): Promise<WorkflowRunRecord> =>
      workflowRunRecord(definition, instance.id, createdAt, await status());

    const identity = { runId: instance.id, workflowName: definition.name } satisfies Partial<
      WorkflowRunHandle<TOutput>
    >;

    if (definition.version !== undefined) {
      Object.assign(identity, { workflowVersion: definition.version } satisfies Partial<
        WorkflowRunHandle<TOutput>
      >);
    }

    return {
      ...identity,
      getRun: record,
      status: async () => cloudflareRunStatus((await status()).status),
      events: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow event history"),
      timeline: async () => WorkflowCapabilityError.unsupported("Cloudflare workflow timeline"),
      result: async (options) =>
        await cloudflareWorkflowResult<TOutput>(
          definition,
          instance,
          options,
          this.#resultPollInterval,
        ),
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
  definition: WorkflowDefinition<unknown, TOutput>,
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
      // SAFETY: The decoder verifies the workflow name/version; the entrypoint serializes output from that registered handler.
      return decodeCloudflareWorkflowResult(state, definition) as TOutput;
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

  const result = {
    id: runId,
    namespace: "cloudflare",
    workflowName: definition.name,
  } satisfies Partial<WorkflowRunRecord>;

  if (definition.version !== undefined) {
    Object.assign(result, {
      workflowVersion: definition.version,
    } satisfies Partial<WorkflowRunRecord>);
  }

  const result1 = Object.assign(result, { status } satisfies Partial<WorkflowRunRecord>);

  if (state.status === "complete") {
    Object.assign(result1, {
      output: decodeCloudflareWorkflowResult(state, definition),
    } satisfies Partial<WorkflowRunRecord>);
  }

  if (state.error !== undefined) {
    Object.assign(result1, {
      error: {
        name: state.error.name,
        message: state.error.message,
      },
    } satisfies Partial<WorkflowRunRecord>);
  }

  const result2 = Object.assign(result1, {
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
  } satisfies Partial<WorkflowRunRecord>);

  if (status === "completed" || status === "failed" || status === "canceled") {
    Object.assign(result2, { finishedAt: now } satisfies Partial<WorkflowRunRecord>);
  }

  return result2;
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

function unsupportedSchedules(): never {
  return WorkflowCapabilityError.unsupported("Cloudflare workflow schedules");
}

function unsupportedLocks(): never {
  return WorkflowCapabilityError.unsupported("Cloudflare workflow locks");
}

function unsupportedWorkers(): never {
  return WorkflowCapabilityError.unsupported("Cloudflare workflow workers");
}
