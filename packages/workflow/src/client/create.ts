import type {
  WorkflowClient as WorkflowClientContract,
  WorkflowClientAdminApi,
  WorkflowClientHooksApi,
  WorkflowClientLocksApi,
  WorkflowClientMessagesApi,
  WorkflowClientRunsApi,
  WorkflowClientSchedulesApi,
  WorkflowClientStreamsApi,
  WorkflowClientWorkersApi,
  WorkflowRunnable,
} from "../types/client.ts";
import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  RegistryLike,
} from "../types/definition.ts";
import type { CreateWorkflowEngineOptions } from "../types/engine-options.ts";
import type { WorkflowClientEngine, WorkflowWorkerEngine } from "../types/engine.ts";

import {
  createWorkflowClientAdminApi,
  createWorkflowClientHooksApi,
  createWorkflowClientLocksApi,
  createWorkflowClientMessagesApi,
  createWorkflowClientRunsApi,
  createWorkflowClientSchedulesApi,
  createWorkflowClientStreamsApi,
  createWorkflowClientWorkersApi,
} from "../client/facades.ts";
import { createWorkflowEngine } from "../engine/create.ts";
import { Registry } from "../registry.ts";

type WorkflowClientEngineOptions = Omit<CreateWorkflowEngineOptions, "storage" | "store">;

export interface CreateWorkflowClientOptions extends WorkflowClientEngineOptions {
  readonly engine?: WorkflowClientEngine;
  readonly workerEngine?: WorkflowWorkerEngine;
  readonly registry?: RegistryLike;
}

export function createWorkflowClient(
  options: CreateWorkflowClientOptions = {},
): WorkflowClientContract {
  return new WorkflowClient(options);
}

/** Workflow client facade implementation. */
export class WorkflowClient implements WorkflowClientContract {
  readonly runs: WorkflowClientRunsApi;
  readonly admin: WorkflowClientAdminApi;
  readonly schedules: WorkflowClientSchedulesApi;
  readonly locks: WorkflowClientLocksApi;
  readonly hooks: WorkflowClientHooksApi;
  readonly streams: WorkflowClientStreamsApi;
  readonly messages: WorkflowClientMessagesApi;
  readonly workers: WorkflowClientWorkersApi;
  readonly #engine: WorkflowClientEngine;
  readonly #workerEngine?: WorkflowWorkerEngine;
  readonly #now: () => Temporal.Instant;
  readonly #registry: RegistryLike;

  constructor(options: CreateWorkflowClientOptions = {}) {
    const { engine, workerEngine, registry, now, ...engineOptions } = options;
    this.#now = now ?? Temporal.Now.instant;
    this.#engine = engine ?? createWorkflowEngine({ ...engineOptions, now: this.#now });
    this.#workerEngine = workerEngine ?? workflowWorkerEngineFromCandidate(this.#engine);
    this.#registry = registry ?? new Registry();
    this.runs = createWorkflowClientRunsApi(() => this.#engine, this.#now);
    this.admin = createWorkflowClientAdminApi(() => this.#engine, this.#now);
    this.schedules = createWorkflowClientSchedulesApi(() => this.#engine, this.#now);
    this.locks = createWorkflowClientLocksApi(() => this.#engine);
    this.hooks = createWorkflowClientHooksApi(() => this.#engine);
    this.streams = createWorkflowClientStreamsApi(() => this.#engine);
    this.messages = createWorkflowClientMessagesApi(() => this.#engine);
    this.workers = createWorkflowClientWorkersApi(
      () => this.#workerEngine,
      () => this.#registry,
      this.#now,
    );
  }

  async close(): Promise<void> {
    await this.#engine.close?.();
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
    if (this.#registry.get(implementation.definition) === implementation) {
      return;
    }
    this.#registry.register(implementation);
  }

  workflow<TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowRunnable<TInput, TOutput, TRawInput> {
    this.#registry.implementWorkflow(definition, handler);
    return {
      definition,
      run: (...runArgs) => this.runs.start(definition, ...runArgs),
    };
  }
}

function workflowWorkerEngineFromCandidate(
  engine: WorkflowClientEngine,
): WorkflowWorkerEngine | undefined {
  return isWorkflowWorkerEngine(engine) ? engine : undefined;
}

function isWorkflowWorkerEngine(candidate: unknown): candidate is WorkflowWorkerEngine {
  const engine = candidate as {
    readonly getRun?: unknown;
    readonly getRunSummary?: unknown;
    readonly listSchedules?: unknown;
    readonly resumeWorkflow?: unknown;
    readonly store?: unknown;
    readonly tickSchedules?: unknown;
  };
  if (
    typeof engine.resumeWorkflow !== "function" ||
    typeof engine.getRun !== "function" ||
    typeof engine.getRunSummary !== "function" ||
    typeof engine.listSchedules !== "function" ||
    typeof engine.tickSchedules !== "function" ||
    engine.store === undefined
  ) {
    return false;
  }
  return true;
}
