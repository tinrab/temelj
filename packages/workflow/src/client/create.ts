import type { Unsubscribe } from "@temelj/event";

import type { WorkflowBundle } from "../bundle.ts";
import type { WorkflowEngine } from "../engine/create.ts";
import type {
  WorkflowClient as WorkflowClientContract,
  ClientAdminApi,
  ClientHooksApi,
  ClientLocksApi,
  ClientMessagesApi,
  ClientRunsApi,
  ClientSchedulesApi,
  ClientStreamsApi,
  ClientWorkersApi,
} from "../types/client.ts";
import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  RegistryLike,
} from "../types/definition.ts";
import type { CreateWorkflowEngineOptions } from "../types/engine-options.ts";
import type { ObservationEventHandler, ObservationEventPattern } from "../types/observation.ts";

import {
  createClientAdminApi,
  createClientHooksApi,
  createClientLocksApi,
  createClientMessagesApi,
  createClientRunsApi,
  createClientSchedulesApi,
  createClientStreamsApi,
  createClientWorkersApi,
} from "../client/facades.ts";
import { createWorkflowEngine } from "../engine/create.ts";
import { Registry } from "../registry.ts";

/** Engine options, such as `storage` or `store`, plus the workflows the client starts with. */
export interface CreateWorkflowClientOptions extends CreateWorkflowEngineOptions {
  readonly workflows?: WorkflowBundle;
}

/** Client options that share a registry with workers built over the same engine. Internal. */
export type ClientForEngineOptions = CreateWorkflowEngineOptions &
  (
    | { readonly registry?: RegistryLike; readonly workflows?: never }
    | { readonly registry?: never; readonly workflows?: WorkflowBundle }
  );

export function createWorkflowClient(
  options: CreateWorkflowClientOptions = {},
): WorkflowClientContract {
  return new WorkflowClient(options);
}

/** A client over an existing engine, so several clients and workers share one engine. Internal. */
export function clientForEngine(
  engine: WorkflowEngine,
  options: ClientForEngineOptions = {},
): WorkflowClientContract {
  return new WorkflowClient(options, engine);
}

export class WorkflowClient implements WorkflowClientContract {
  readonly runs: ClientRunsApi;
  readonly admin: ClientAdminApi;
  readonly schedules: ClientSchedulesApi;
  readonly locks: ClientLocksApi;
  readonly hooks: ClientHooksApi;
  readonly streams: ClientStreamsApi;
  readonly messages: ClientMessagesApi;
  readonly workers: ClientWorkersApi;
  readonly #engine: WorkflowEngine;
  readonly #now: () => Temporal.Instant;
  readonly #registry: RegistryLike;

  constructor(options: ClientForEngineOptions = {}, engine?: WorkflowEngine) {
    const { registry, workflows, now, ...engineOptions } = options;

    if (registry !== undefined && workflows !== undefined) {
      throw new TypeError("Workflow client options cannot include both registry and workflows");
    }

    this.#now = now ?? Temporal.Now.instant;
    this.#engine = engine ?? createWorkflowEngine({ ...engineOptions, now: this.#now });
    this.#registry = registry ?? new Registry(workflows?.workflows);
    this.runs = createClientRunsApi(this.#engine, this.#now, this.#registry);
    this.admin = createClientAdminApi(this.#engine, this.#now);
    this.schedules = createClientSchedulesApi(this.#engine, this.#now);
    this.locks = createClientLocksApi(this.#engine);
    this.hooks = createClientHooksApi(this.#engine);
    this.streams = createClientStreamsApi(this.#engine);
    this.messages = createClientMessagesApi(this.#engine);
    this.workers = createClientWorkersApi(this.#engine, this.#registry, this.#now);
  }

  on<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): Unsubscribe {
    return this.#engine.observation.on(pattern, handler);
  }

  once<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): Unsubscribe {
    return this.#engine.observation.once(pattern, handler);
  }

  off<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): void {
    this.#engine.observation.off(pattern, handler);
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
}
