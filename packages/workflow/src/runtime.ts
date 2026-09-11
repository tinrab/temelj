import type { StorageValue } from "@temelj/storage";

import { isFunction } from "@temelj/value";

import type {
  CompiledWorkflowFunction,
  WorkflowClient,
  WorkflowClientWorkersApi,
  WorkflowRunHandle,
} from "./types/client.ts";

import "temporal-polyfill/global";

import type {
  WorkflowDefinition,
  WorkflowStartTarget,
  WorkflowHandler,
  WorkflowImplementation,
  RegistryLike,
} from "./types/definition.ts";
import type { ResultOptions } from "./types/result.ts";
import type {
  WorkflowRunArguments,
  WorkflowStartOptions,
  WorkflowMarkRunPermanentlyFailedOptions,
  WorkflowReleaseStaleLeaseOptions,
  WorkflowRescheduleRunOptions,
  WorkflowRetryFailedRunOptions,
} from "./types/run-options.ts";
import type { RunId, WorkflowAttributePatch, WorkflowRunRecord } from "./types/run.ts";
import type {
  CreateWorkflowRuntimeOptions,
  WorkflowRuntime as WorkflowRuntimeContract,
  WorkflowRuntimeLocksApi,
  WorkflowRuntimeRunsApi,
  WorkflowRuntimeSchedulesApi,
} from "./types/runtime.ts";
import type {
  FollowStreamOptions,
  ReadStreamOptions,
  ReadStreamPageOptions,
  WaitStreamOptions,
} from "./types/stream.ts";

import { createWorkflowClient } from "./client/create.ts";
import { getCompiledWorkflowDefinition } from "./compiled-function.ts";
import {
  WorkflowDefinitionError,
  WorkflowRuntimeError,
  WorkflowRunCanceledError,
  WorkflowRunNotFoundError,
  WorkflowResultTimeoutError,
  WorkflowStateError,
} from "./errors/mod.ts";
import { workflowErrorFromRecord } from "./errors/records.ts";
import { Registry } from "./registry.ts";
import { durationTotal } from "./temporal.ts";
import { durationBetween } from "./temporal.ts";
import { sleep, nonNegativeTimerDelay } from "./timer.ts";
import { StreamIdOrName } from "./types/stream-id.ts";

const DEFAULT_RESULT_POLL_INTERVAL = Temporal.Duration.from({ milliseconds: 100 });

const WORKFLOW_RUNTIME_CLOCKS = new WeakMap<WorkflowRuntimeContract, () => Temporal.Instant>();

const WORKFLOW_RUNTIME_CLIENTS = new WeakMap<WorkflowRuntimeContract, WorkflowClient>();

const WORKFLOW_RUNTIME_REGISTRIES = new WeakMap<WorkflowRuntimeContract, RegistryLike>();

/** Creates a workflow runtime backed by a workflow client. */
export function createWorkflowRuntime(
  options: CreateWorkflowRuntimeOptions = {},
): WorkflowRuntimeContract {
  return new WorkflowRuntime(options);
}

/** Workflow runtime implementation backed by a workflow client. */
export class WorkflowRuntime implements WorkflowRuntimeContract {
  readonly runs: WorkflowRuntimeRunsApi;
  readonly schedules: WorkflowRuntimeSchedulesApi;
  readonly locks: WorkflowRuntimeLocksApi;
  readonly workers: WorkflowClientWorkersApi;
  readonly #client: WorkflowClient;
  readonly #registry: RegistryLike;

  constructor(options: CreateWorkflowRuntimeOptions = {}) {
    const { registry, workflows, ...runtimeOptions } = options;

    if (registry !== undefined && workflows !== undefined) {
      throw new TypeError("Workflow runtime options cannot include both registry and workflows");
    }

    const now = options.now ?? Temporal.Now.instant;
    this.#registry = registry ?? new Registry(workflows?.workflows);
    this.#client = createWorkflowClient({ ...runtimeOptions, registry: this.#registry, now });
    this.runs = {
      getHandle: async (runId) => await getWorkflowRuntimeRun(this, runId),
      list: async (options) => await this.#client.runs.list(options),
    };
    this.schedules = this.#client.schedules;
    this.locks = this.#client.locks;
    this.workers = this.#client.workers;
    WORKFLOW_RUNTIME_CLOCKS.set(this, now);
    WORKFLOW_RUNTIME_CLIENTS.set(this, this.#client);
    WORKFLOW_RUNTIME_REGISTRIES.set(this, this.#registry);
  }

  async close(): Promise<void> {
    await this.#client.close();
  }

  implementWorkflow<TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> {
    return this.#registry.implementWorkflow(definition, handler);
  }

  register<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void {
    this.#registry.register(implementation);
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
    workflow:
      | WorkflowDefinition
      | WorkflowImplementation
      | CompiledWorkflowFunction<unknown[], unknown>,
    ...args: unknown[]
  ): Promise<WorkflowRunHandle<unknown>> {
    return await startWorkflowRuntimeRunUnknown(this, workflow, ...args);
  }
}

/** Starts a workflow through an explicit runtime and returns a client run handle. */
export function startWorkflowRuntimeRun<TInput, TOutput, TRawInput = TInput>(
  runtime: WorkflowRuntime,
  workflow: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ...args: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
): Promise<WorkflowRunHandle<TOutput>>;

/** Starts a workflow through an explicit runtime and returns a client run handle. */
export function startWorkflowRuntimeRun<TInput, TOutput, TRawInput = TInput>(
  runtime: WorkflowRuntime,
  workflow: WorkflowDefinition<TInput, TOutput, TRawInput>,
  ...args: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
): Promise<WorkflowRunHandle<TOutput>>;

/** Starts a workflow through an explicit runtime and returns a client run handle. */
export function startWorkflowRuntimeRun<TArgs extends readonly unknown[], TOutput>(
  runtime: WorkflowRuntime,
  workflow: CompiledWorkflowFunction<TArgs, TOutput>,
  ...args: TArgs
): Promise<WorkflowRunHandle<Awaited<TOutput>>>;

/** Starts a workflow through an explicit runtime and returns a client run handle. */
export async function startWorkflowRuntimeRun(
  runtime: WorkflowRuntime,
  workflow: WorkflowStartTarget | Function,
  ...args: unknown[]
): Promise<WorkflowRunHandle<unknown>> {
  return await startWorkflowRuntimeRunUnknown(runtime, workflow, ...args);
}

async function startWorkflowRuntimeRunUnknown(
  runtime: WorkflowRuntime,
  workflow: WorkflowStartTarget | Function,
  ...args: unknown[]
): Promise<WorkflowRunHandle<unknown>> {
  const client = getWorkflowRuntimeClient(runtime);
  const registry = getWorkflowRuntimeRegistry(runtime);

  if (isFunction(workflow)) {
    const definition = getCompiledWorkflowDefinition(workflow);

    if (definition === undefined) {
      WorkflowDefinitionError.compiledMetadataMissing();
    }

    ensureWorkflowRegistered(registry, definition);

    return await client.runs.start(definition.definition, args);
  }

  // SAFETY: The function overload was handled above. Both remaining overloads place WorkflowStartOptions in the second argument.
  const [input, options] = args as [unknown, WorkflowStartOptions?];

  if (workflow.kind === "implementation") {
    ensureWorkflowRegistered(registry, workflow);

    return await client.runs.start(workflow.definition, input, options);
  }

  return await client.runs.start(workflow, input, options);
}

/** Returns a handle with persisted output for an existing run through an explicit runtime. */
export async function getWorkflowRuntimeRun(
  runtime: WorkflowRuntime,
  runId: RunId,
): Promise<WorkflowRunHandle<StorageValue | undefined>> {
  const client = getWorkflowRuntimeClient(runtime);
  const run = await client.runs.get(runId);

  if (run === undefined) {
    WorkflowRunNotFoundError.notFound(runId);
  }

  return createStoredRunHandle(runtime, run);
}

function createStoredRunHandle(
  runtime: WorkflowRuntime,
  initialRun: WorkflowRunRecord,
): WorkflowRunHandle<StorageValue | undefined> {
  const runId = initialRun.id;
  const now = WORKFLOW_RUNTIME_CLOCKS.get(runtime) ?? Temporal.Now.instant;
  const client = getWorkflowRuntimeClient(runtime);

  const getRun = async () => {
    const run = await client.runs.get(runId);

    if (run === undefined) {
      WorkflowRunNotFoundError.notFound(runId);
    }

    return run;
  };

  const identity = { runId: runId, workflowName: initialRun.workflowName } satisfies Partial<
    WorkflowRunHandle<StorageValue | undefined>
  >;

  if (initialRun.workflowVersion !== undefined) {
    Object.assign(identity, { workflowVersion: initialRun.workflowVersion } satisfies Partial<
      WorkflowRunHandle<StorageValue | undefined>
    >);
  }

  return {
    ...identity,

    getRun,

    async status() {
      return (await getRun()).status;
    },

    async events() {
      return await client.runs.events(runId);
    },

    async timeline() {
      return await client.runs.timeline(runId);
    },

    async result(options?: ResultOptions): Promise<StorageValue | undefined> {
      const pollInterval = nonNegativeTimerDelay(
        options?.pollInterval ?? DEFAULT_RESULT_POLL_INTERVAL,
        "Workflow result pollInterval",
      ).clampedDelay;

      const timeout = options?.timeout;
      const deadlineAt = timeout === undefined ? undefined : now().add(timeout);

      while (true) {
        const run = await client.runs.get(runId);

        if (run === undefined) {
          WorkflowRunNotFoundError.notFound(runId);
        }

        if (run.status === "completed") {
          return run.output;
        }

        if (run.status === "failed") {
          if (run.error === undefined) {
            WorkflowStateError.failedRunMissingError(runId);
          }

          throw workflowErrorFromRecord(run.error);
        }

        if (run.status === "canceled") {
          WorkflowRunCanceledError.canceled(runId);
        }

        let sleepDelay = pollInterval;

        if (timeout !== undefined && deadlineAt !== undefined) {
          const remainingDelay = durationTotal(durationBetween(now(), deadlineAt));

          if (remainingDelay <= 0) {
            WorkflowResultTimeoutError.timedOut(runId, timeout);
          }

          sleepDelay = Math.min(sleepDelay, remainingDelay);
        }

        await sleep(sleepDelay);
      }
    },

    async getStreamInfo(streamIdOrName: StreamIdOrName) {
      return await client.streams.getInfo(runId, streamIdOrName);
    },

    followStream(streamIdOrName: StreamIdOrName, options?: FollowStreamOptions) {
      return client.streams.follow(runId, streamIdOrName, options);
    },

    async waitForStream(streamIdOrName: StreamIdOrName, options?: WaitStreamOptions) {
      return await client.streams.wait(runId, streamIdOrName, options);
    },

    async waitForStreamChunk(
      streamIdOrName: StreamIdOrName,
      afterIndex: number,
      options?: WaitStreamOptions,
    ) {
      return await client.streams.waitForChunk(runId, streamIdOrName, afterIndex, options);
    },

    async waitForStreamTerminal(streamIdOrName: StreamIdOrName, options?: WaitStreamOptions) {
      return await client.streams.waitForTerminal(runId, streamIdOrName, options);
    },

    async readStream(streamIdOrName: StreamIdOrName, options?: ReadStreamOptions) {
      return await client.streams.read(runId, streamIdOrName, options);
    },

    async readStreamPage(streamIdOrName: StreamIdOrName, options?: ReadStreamPageOptions) {
      return await client.streams.readPage(runId, streamIdOrName, options);
    },

    async reschedule(options?: WorkflowRescheduleRunOptions) {
      return await client.admin.reschedule(runId, options);
    },

    async releaseStaleLease(options?: WorkflowReleaseStaleLeaseOptions) {
      return await client.admin.releaseStaleLease(runId, options);
    },

    async retryFailed(options?: WorkflowRetryFailedRunOptions) {
      return await client.admin.retryFailed(runId, options);
    },

    async markPermanentlyFailed(options: WorkflowMarkRunPermanentlyFailedOptions) {
      return await client.admin.markPermanentlyFailed(runId, options);
    },

    async setMetadata(metadata: StorageValue) {
      return await client.admin.updateMetadata(runId, metadata);
    },

    async setAttributes(attributes: WorkflowAttributePatch) {
      return await client.admin.setAttributes(runId, attributes);
    },

    async cancel() {
      return await client.admin.cancel(runId);
    },
  };
}

function getWorkflowRuntimeClient(runtime: WorkflowRuntime): WorkflowClient {
  const client = WORKFLOW_RUNTIME_CLIENTS.get(runtime);

  if (client === undefined) {
    WorkflowRuntimeError.clientMissing();
  }

  return client;
}

function getWorkflowRuntimeRegistry(runtime: WorkflowRuntime): RegistryLike {
  const registry = WORKFLOW_RUNTIME_REGISTRIES.get(runtime);

  if (registry === undefined) {
    WorkflowRuntimeError.registryMissing();
  }

  return registry;
}

function ensureWorkflowRegistered<TInput, TOutput, TRawInput>(
  registry: RegistryLike,
  implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
): void {
  const existing = registry.get(implementation.definition);

  if (existing === undefined) {
    registry.register(implementation);
  }
}
