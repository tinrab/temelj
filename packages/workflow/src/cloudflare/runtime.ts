import { isFunction } from "@temelj/value";

import type { CompiledWorkflowFunction } from "../types/client.ts";
import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  RegistryLike,
  StartTarget,
} from "../types/definition.ts";
import type { RunId } from "../types/ids.ts";
import type {
  SendMessageChannelOptions,
  SendMessageInput,
  MessageChannel,
  MessageSender,
} from "../types/message.ts";
import type { ResultOptions } from "../types/result.ts";
import type { RunArguments, StartOptions } from "../types/run-options.ts";
import type { RunRecord, RunStatus } from "../types/run.ts";
import type { RunHandle, RuntimeRunsApi, WorkflowRuntime } from "../types/runtime.ts";
import type {
  CloudflareWorkflowInstanceCreateOptions,
  CloudflareWorkflowBinding,
  CloudflareWorkflowInstance,
  CloudflareWorkflowInstanceStatus,
} from "./types.ts";

import { getCompiledDefinition } from "../compiled-function.ts";
import { defineFromTarget } from "../definition.ts";
import { parseInput } from "../engine/serialization.ts";
import {
  WorkflowCapabilityError,
  WorkflowDefinitionError,
  WorkflowResultTimeoutError,
  WorkflowRunCanceledError,
} from "../errors/mod.ts";
import { resolveSendMessageInput } from "../message-options.ts";
import { Registry } from "../registry.ts";
import {
  durationMilliseconds,
  decodeCloudflareResult,
  encodeCloudflareValue,
  type CloudflareEnvelope,
} from "./codec.ts";
import { makeCloudflareEventType } from "./name.ts";

const DEFAULT_RESULT_POLL_INTERVAL = 100;

const CLOUDFLARE_INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;

export interface CreateCloudflareWorkflowRuntimeOptions {
  readonly binding: CloudflareWorkflowBinding;
  readonly registry?: RegistryLike;
  readonly resultPollInterval?: Temporal.Duration;
  /** Controls whether workflows absent from the initial registry may be registered at runtime. */
  readonly registration?: "dynamic" | "static";
}

export interface CloudflareWorkflowRuntimeRunsApi extends RuntimeRunsApi {
  get<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    runId: RunId,
  ): Promise<RunHandle<TOutput>>;
}

export interface CloudflareWorkflowRuntime extends WorkflowRuntime {
  readonly runs: CloudflareWorkflowRuntimeRunsApi;
  readonly messages: MessageSender;
}

/** Creates a runtime facade over a generic Cloudflare Workflow binding. */
export function createCloudflareWorkflowRuntime(
  options: CreateCloudflareWorkflowRuntimeOptions,
): CloudflareWorkflowRuntime {
  return new CloudflareRuntimeImpl(options);
}

class CloudflareRuntimeImpl implements CloudflareWorkflowRuntime {
  readonly runs: CloudflareWorkflowRuntimeRunsApi;
  readonly messages: MessageSender;
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
    // Defined here so the overloads can reach private members.
    // oxlint-disable-next-line typescript/no-this-alias -- The overloaded function needs the instance.
    const runtime = this;

    async function start<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowDefinition<TInput, TOutput, TRawInput>,
      ...args: RunArguments<TRawInput, StartOptions>
    ): Promise<RunHandle<TOutput>>;
    async function start<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowImplementation<TInput, TOutput, TRawInput>,
      ...args: RunArguments<TRawInput, StartOptions>
    ): Promise<RunHandle<TOutput>>;
    async function start<TArgs extends readonly unknown[], TOutput>(
      workflow: CompiledWorkflowFunction<TArgs, TOutput>,
      ...args: TArgs
    ): Promise<RunHandle<Awaited<TOutput>>>;
    async function start(
      workflow: StartTarget | Function,
      ...args: unknown[]
    ): Promise<RunHandle<unknown>> {
      if (isFunction(workflow)) {
        const implementation = getCompiledDefinition(workflow);

        if (implementation === undefined) {
          WorkflowDefinitionError.compiledMetadataMissing();
        }

        runtime.register(implementation);

        return await runtime.#startTarget(implementation, args, undefined);
      }

      // SAFETY: The function overload was handled above. Both remaining overloads place WorkflowStartOptions in the second argument.
      const [input, options] = args as [unknown, StartOptions?];

      if (workflow.kind === "implementation") {
        runtime.register(workflow);
      }

      return await runtime.#startTarget(workflow, input, options);
    }

    this.runs = {
      start,
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
          type: makeCloudflareEventType(message.messageId),
          payload: encodeCloudflareValue(message.payload),
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

  async #startTarget<TInput, TOutput, TRawInput>(
    target: StartTarget<TInput, TOutput, TRawInput>,
    rawInput: TRawInput,
    startOptions: StartOptions | undefined,
  ): Promise<RunHandle<TOutput>> {
    rejectUnsupportedStartOptions(startOptions);

    if (
      startOptions?.workflowVersion !== undefined &&
      startOptions.workflowVersion !== target.version
    ) {
      throw new WorkflowDefinitionError("Cloudflare start target version mismatch");
    }

    const implementation = this.#registeredImplementation(target);

    if (implementation.config.retry !== undefined) {
      WorkflowCapabilityError.unsupported("Cloudflare workflow-level retry configuration");
    }

    await parseInput(implementation.definition, rawInput);

    const envelope: CloudflareEnvelope = {
      kind: "temelj-workflow",
      version: 1,
      workflowName: implementation.name,
      workflowVersion: implementation.version,
      input: encodeCloudflareValue(rawInput),
    };

    const id = await resolveInstanceId(implementation.name, implementation.version, startOptions);
    const createdAt = Temporal.Now.instant();
    let instance: CloudflareWorkflowInstance;

    if (startOptions?.idempotencyKey === undefined) {
      const createOptions: CloudflareWorkflowInstanceCreateOptions = {
        id,
        params: envelope,
      };

      instance = await this.#binding.create(createOptions);
    } else {
      if (id === undefined) {
        throw new TypeError("Cloudflare idempotent workflow start requires a resolved instance id");
      }

      try {
        const instances = await this.#binding.createBatch([{ id, params: envelope }]);
        instance = instances[0] ?? (await this.#binding.get(id));
      } catch (cause) {
        try {
          instance = await this.#binding.get(id);
        } catch {
          throw cause;
        }
      }
    }

    return this.#handle(implementation.definition, instance, createdAt);
  }

  async #createHandle<TInput, TOutput, TRawInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    runId: RunId,
  ): Promise<RunHandle<TOutput>> {
    const implementation = this.#registeredImplementation(workflow);

    const instance = await this.#binding.get(runId);

    return this.#handle(implementation.definition, instance, Temporal.Now.instant());
  }

  #registeredImplementation<TInput, TOutput, TRawInput>(
    target: StartTarget<TInput, TOutput, TRawInput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> {
    const implementation = this.#registry.get(defineFromTarget(target));

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
  ): RunHandle<TOutput> {
    const status = () => instance.status();

    const record = async (): Promise<RunRecord> =>
      workflowRunRecord(definition, instance.id, createdAt, await status());

    return {
      runId: instance.id,
      workflowName: definition.name,
      workflowVersion: definition.version,
      getRun: record,
      status: async () => cloudflareRunStatus((await status()).status),
      result: (options) =>
        cloudflareResult<TOutput>(definition, instance, options, this.#resultPollInterval),
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

async function cloudflareResult<TOutput>(
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
      return decodeCloudflareResult(state, definition) as TOutput;
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
): RunRecord {
  const now = Temporal.Now.instant();
  const status = cloudflareRunStatus(state.status);

  return {
    id: runId,
    namespace: "cloudflare",
    workflowName: definition.name,
    workflowVersion: definition.version,
    status,
    output: state.status === "complete" ? decodeCloudflareResult(state, definition) : undefined,
    error:
      state.error !== undefined
        ? {
            name: state.error.name,
            message: state.error.message,
          }
        : undefined,
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
    finishedAt:
      status === "completed" || status === "failed" || status === "canceled" ? now : undefined,
  };
}

function cloudflareRunStatus(status: CloudflareWorkflowInstanceStatus["status"]): RunStatus {
  switch (status) {
    case "queued":
      return "pending";
    case "running":
    case "rollingBack":
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
  options: StartOptions | undefined,
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

function rejectUnsupportedStartOptions(options: StartOptions | undefined): void {
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
