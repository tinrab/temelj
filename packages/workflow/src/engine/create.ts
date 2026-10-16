import { createNoopLogger, type Logger } from "@temelj/log";
import { createStorage, type StorageValue } from "@temelj/storage";

import type {
  WorkflowDefinition,
  WorkflowImplementation,
  StartTarget,
} from "../types/definition.ts";
import type { CreateWorkflowEngineOptions, ExecutionLimits } from "../types/engine-options.ts";
import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { AcquireLockOptions, LockRecord, ReleaseLockOptions } from "../types/lock.ts";
import type { ObservationEmitter } from "../types/observation.ts";
import type { ExecutionResult } from "../types/result.ts";
import type { ListRunsOptions } from "../types/run-list.ts";
import type {
  BatchStartItem,
  ExecutionOptions,
  RerunOptions,
  ResumeOptions,
  ScheduleNextOptions,
  StartOptions,
} from "../types/run-options.ts";
import type { RunRecord } from "../types/run.ts";
import type {
  ScheduleConfig,
  ScheduleRecord,
  TickSchedulesOptions,
  TickSchedulesResult,
} from "../types/schedule.ts";
import type { WorkflowStore, WorkflowStorage } from "../types/store.ts";
import type { RunSummary } from "../types/summary.ts";
import type { Telemetry } from "../types/telemetry.ts";
import type { EngineContext } from "./context.ts";

import { defineFromTarget } from "../definition.ts";
import { WorkflowOptionsError } from "../errors/base.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { createDefaultRunIdFactory, createDefaultRecordedIdFactory } from "../ids.ts";
import { createWorkflowStore } from "../store/create.ts";
import { instrumentStorage } from "../store/instrumentation.ts";
import { getWorkflowRunSummary } from "./inspection.ts";
import { createLifecycleEmitter } from "./lifecycle.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { createObservationEmitter } from "./observation.ts";
import { resumeRun, type ResumeRunServices } from "./resume.ts";
import { rerunRun } from "./run-service.ts";
import { readRunResult } from "./run-utils.ts";
import { resolveScheduleRecord, tickSchedules } from "./schedule.ts";
import { getRunRef, resolveScheduleNextOptions, startRun, type RunRef } from "./start.ts";

const MAX_CRYPTO_GET_RANDOM_VALUES_BYTES = 65_536;

interface EngineRunLifecycle {
  readonly emitLifecycleEvent: (next: RunRecord, previous: RunRecord) => void | Promise<void>;
  readonly emitRunMetadataUpdated: (next: RunRecord, previous: RunRecord) => void;
}

function defaultDeterministicRandom(): number {
  return Math.random();
}

function defaultDeterministicUuid(): string {
  return globalThis.crypto.randomUUID();
}

function defaultDeterministicBytes(context: { readonly length: number }): Uint8Array {
  const bytes = new Uint8Array(context.length);

  for (let offset = 0; offset < bytes.byteLength; offset += MAX_CRYPTO_GET_RANDOM_VALUES_BYTES) {
    const chunk = bytes.subarray(offset, offset + MAX_CRYPTO_GET_RANDOM_VALUES_BYTES);
    globalThis.crypto.getRandomValues(chunk);
  }

  return bytes;
}

export function createWorkflowEngine(options: CreateWorkflowEngineOptions = {}): WorkflowEngine {
  return new WorkflowEngine(options);
}

/** Executes workflows against a store; the client and workers build on it. */
export class WorkflowEngine {
  public readonly storage: WorkflowStorage;
  public readonly store: WorkflowStore;
  readonly #now: () => Temporal.Instant;
  readonly #limits: ExecutionLimits;
  readonly #logger: Logger;
  readonly #telemetry?: Telemetry;
  readonly observation: ObservationEmitter;
  readonly #resumeServices: ResumeRunServices;
  /** Shared by the engine's services and the client facades. */
  readonly context: EngineContext;
  readonly lifecycle: EngineRunLifecycle;

  constructor(options: CreateWorkflowEngineOptions = {}) {
    if (options.store !== undefined && options.storage !== undefined) {
      throw new WorkflowOptionsError(
        "Workflow engine options cannot include both store and storage",
        { code: WorkflowErrorCode.OPTIONS_ENGINE_STORE_STORAGE_CONFLICT },
      );
    }

    const telemetry = options.telemetry === false ? undefined : options.telemetry;

    const storage =
      options.store === undefined
        ? instrumentStorage(options.storage ?? createStorage(), telemetry)
        : undefined;

    this.store = options.store ?? createWorkflowStore({ storage });
    this.storage = this.store.storage;
    const now = options.now ?? Temporal.Now.instant;
    this.#now = now;
    const createRunId = options.createRunId ?? createDefaultRunIdFactory(now);

    const createRecordedId =
      options.createRecordedId ?? createDefaultRecordedIdFactory(createRunId);

    const createDeterministicRandom =
      options.createDeterministicRandom ?? defaultDeterministicRandom;

    const createDeterministicUuid = options.createDeterministicUuid ?? defaultDeterministicUuid;
    const createDeterministicBytes = options.createDeterministicBytes ?? defaultDeterministicBytes;
    const maximumStepAttemptsPerRun = options.maximumStepAttemptsPerRun ?? 1_000;

    const limits: ExecutionLimits = {
      maximumPersistedValueBytes: options.maximumPersistedValueBytes,
      maximumEventHistoryEvents: options.maximumEventHistoryEvents,
      maximumStreamChunks: options.maximumStreamChunks,
    };

    this.#limits = limits;

    const readCurrentRunResult = async <TOutput>(
      definition: WorkflowDefinition<unknown, TOutput, unknown>,
      runId: RunId,
    ): Promise<ExecutionResult<TOutput>> =>
      await readRunResult(this.store, definition, runId, now());

    const logger =
      options.logger === false ? createNoopLogger() : (options.logger ?? createNoopLogger());

    this.#telemetry = telemetry;
    this.#logger = logger;
    const observation = createObservationEmitter(telemetry);
    this.observation = observation;
    this.context = { store: this.store, now, limits, observation, telemetry, logger, createRunId };

    const { emitLifecycleEvent, emitResultLifecycleEvent } = createLifecycleEmitter(
      options,
      observation,
    );

    this.lifecycle = {
      emitLifecycleEvent,
      emitRunMetadataUpdated: observation.emitRunMetadataUpdated,
    };

    const executionService = {
      store: this.store,
      now,
      createRecordedId,
      createDeterministicRandom,
      createDeterministicUuid,
      createDeterministicBytes,
      maximumStepAttemptsPerRun,
      limits,
      telemetry,
      logger,
      engine: this,
      readCurrentRunResult,
      emitResultLifecycleEvent,
      observeRunEvent: observation.emitRunEvent,
      observeDurableEventAppended: observation.emitDurableEventAppended,
      observeMessageSent: observation.emitMessageSent,
      observeChildWorkflowStarted: (
        runId: RunId,
        event: Extract<EventRecord, { readonly kind: "child_workflow_started" }>,
      ) => observation.emitChildWorkflowStarted({ runId, event }),
    };

    this.#resumeServices = { context: this.context, executionService, emitResultLifecycleEvent };

    try {
      telemetry?.bindEngine?.(this);
    } catch {
      // Telemetry setup failures must not prevent engine creation.
    }
  }

  async close(): Promise<void> {
    const errors: unknown[] = [];

    try {
      await this.#logger.close?.();
    } catch (error) {
      errors.push(error);
    }

    try {
      await this.#telemetry?.shutdown?.();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  async startWorkflow<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: StartOptions,
  ): Promise<RunRef<TOutput>> {
    return await startRun(this, workflow, input, options);
  }

  async startWorkflows<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    items: readonly BatchStartItem<TRawInput>[],
  ): Promise<readonly RunRef<TOutput>[]> {
    const handles: RunRef<TOutput>[] = [];

    for (const item of items) {
      handles.push(await this.startWorkflow(workflow, item.input, item.options));
    }

    return handles;
  }

  async getRunRef(runId: RunId): Promise<RunRef<StorageValue | undefined>> {
    return await getRunRef(this, runId);
  }

  async scheduleNextWorkflow<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options: ScheduleNextOptions,
  ): Promise<RunRef<TOutput>> {
    return await this.startWorkflow(
      workflow,
      input,
      resolveScheduleNextOptions(options, this.context.now).start,
    );
  }

  async createSchedule<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    scheduleOptions: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord> {
    const definition = defineFromTarget(workflow);

    const schedule = await resolveScheduleRecord(
      this.store.namespace,
      definition,
      scheduleOptions,
      this.#now(),
      this.#limits,
    );

    return this.store.createSchedule(schedule);
  }

  async tickSchedules(options?: TickSchedulesOptions): Promise<TickSchedulesResult> {
    const timestamp = options?.now ?? this.#now();
    const tickOptions = options === undefined ? { now: timestamp } : { ...options, now: timestamp };
    const result = await tickSchedules(this.store, this, this.#now, tickOptions);
    this.observation.emitScheduleTicked({ result, timestamp });

    return result;
  }

  async acquireLock(key: string, options: AcquireLockOptions): Promise<LockRecord> {
    const acquiredAt = options.now === undefined ? this.#now() : options.now;

    return acquireLock(this.store, key, options, acquiredAt);
  }

  async releaseLock(key: string, options: ReleaseLockOptions): Promise<LockRecord> {
    const releasedAt = options.now === undefined ? this.#now() : options.now;

    return releaseLock(this.store, key, options, releasedAt);
  }

  async runWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: ExecutionOptions,
  ): Promise<RunRef<TOutput>> {
    return await this.startWorkflow(implementation.definition, input, options?.start);
  }

  async runWorkflowNow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: ExecutionOptions,
  ): Promise<ExecutionResult<TOutput>> {
    const handle = await this.startWorkflow(implementation.definition, input, options?.start);

    return await this.resumeWorkflow(implementation, handle.runId, { signal: options?.signal });
  }

  async resumeWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    runId: RunId,
    options?: ResumeOptions,
  ): Promise<ExecutionResult<TOutput>> {
    return await resumeRun(this.#resumeServices, implementation, runId, options);
  }

  async getRunSummary(options?: ListRunsOptions): Promise<RunSummary> {
    return await getWorkflowRunSummary({ store: this.store, now: this.#now(), filters: options });
  }

  async rerunWorkflow(runId: RunId, options?: RerunOptions): Promise<RunRef<unknown>> {
    return rerunRun(
      this.context,
      (definition, input, startOptions) => this.startWorkflow(definition, input, startOptions),
      runId,
      options,
    );
  }
}
