import { createNoopLogger, type Logger } from "@temelj/log";
import { createStorage, type StorageValue } from "@temelj/storage";

import type {
  CleanupMarkerRecord,
  CleanupRunsOptions,
  CleanupRunsResult,
  RetentionPolicyOptions,
} from "../types/cleanup.ts";
import type { WorkflowImplementation, WorkflowStartTarget } from "../types/definition.ts";
import type {
  CreateWorkflowEngineOptions,
  WorkflowExecutionLimits,
} from "../types/engine-options.ts";
import type { WorkflowEngine as WorkflowEngineContract } from "../types/engine.ts";
import type { EventRecord } from "../types/events.ts";
import type { HookInspection, ResumeHookOptions, ResumeWebhookOptions } from "../types/hook.ts";
import type {
  AcquireLockOptions,
  LockRecord,
  ReleaseLockOptions,
  ReleaseStaleLockOptions,
} from "../types/lock.ts";
import type {
  BroadcastMessageInput,
  SendMessageInput,
  MessageChannel,
  SendMessageChannelOptions,
  BroadcastMessageChannelOptions,
} from "../types/message.ts";
import type {
  ObservationEventHandler,
  ObservationEmitter,
  ObservationEventPattern,
  ObservationUnsubscribe,
  ScheduleRunCreatedObservationEvent,
  WorkerOperationObservationEvent,
} from "../types/observation.ts";
import type { WorkflowPage, PageOptions } from "../types/pagination.ts";
import type { ExecutionResult, WorkflowHandle } from "../types/result.ts";
import type {
  WorkflowListRunsOptions,
  WorkflowListRunsPageOptions,
  WorkflowListStepAttemptsPageOptions,
} from "../types/run-list.ts";
import type {
  WorkflowBatchStartItem,
  WorkflowExecutionOptions,
  WorkflowMarkRunPermanentlyFailedOptions,
  WorkflowReleaseStaleLeaseOptions,
  WorkflowRerunOptions,
  WorkflowRescheduleRunOptions,
  WorkflowResumeOptions,
  WorkflowRetryFailedRunOptions,
  ScheduleNextOptions,
  WorkflowStartOptions,
} from "../types/run-options.ts";
import type { RunId, WorkflowAttributePatch, WorkflowRunRecord } from "../types/run.ts";
import type {
  ScheduleId,
  ListSchedulesOptions,
  ListSchedulesPageOptions,
  ScheduleConfig,
  ScheduleRecord,
  TickSchedulesOptions,
  TickSchedulesResult,
} from "../types/schedule.ts";
import type {
  WorkflowListStepAttemptsOptions,
  WorkflowStepAttemptRecord,
  WorkflowStepAttemptSummary,
} from "../types/step-attempts.ts";
import type {
  WorkflowConditionalEventAppender,
  WorkflowEventReader,
  WorkflowEventHistoryWatcher,
  WorkflowLockConditionalWriterRepository,
  WorkflowLockListerRepository,
  WorkflowMessageIdempotencyIndex,
  WorkflowMessageIdempotencyIndexLookup,
  WorkflowRunConditionalWriterRepository,
  WorkflowRunListerRepository,
  WorkflowRunReaderRepository,
  WorkflowRunUnconditionalWriterRepository,
  WorkflowStorage,
  WorkflowStepAttemptLookup,
  WorkflowStore,
} from "../types/store.ts";
import type {
  FollowStreamOptions,
  ReadStreamPageOptions,
  ReadStreamOptions,
  StreamChunk,
  StreamInfo,
  StreamState,
  StreamPage,
  StreamUpdate,
  WaitStreamOptions,
} from "../types/stream.ts";
import type {
  WorkflowRecoverySummary,
  WorkflowRecoverySummaryOptions,
  WorkflowRunSummary,
  WorkflowRunSummaryOptions,
} from "../types/summary.ts";
import type { Telemetry, TelemetryContext } from "../types/telemetry.ts";
import type { Timeline } from "../types/timeline.ts";

import { defineWorkflowFromTarget } from "../definition.ts";
import { WorkflowOptionsError } from "../errors/base.ts";
import { createWorkflowStore } from "../store/create.ts";
import { instrumentWorkflowStorage } from "../store/instrumentation.ts";
import { MessageId } from "../types/message-id.ts";
import { StreamIdOrName } from "../types/stream-id.ts";
import { createDefaultRunIdFactory, createDefaultWorkflowRecordedIdFactory } from "../utility.ts";
import {
  createWorkflowEngineExecutionApi,
  type WorkflowEngineExecutionApi,
} from "./execution-api.ts";
import { disposeHook, disposeWebhook, getHookByToken, resumeHook, resumeWebhook } from "./hooks.ts";
import {
  createWorkflowEngineInspectionApi,
  type WorkflowEngineInspectionApi,
} from "./inspection-api.ts";
import { createWorkflowLifecycleEmitter } from "./lifecycle.ts";
import { acquireLock, releaseStaleLock, releaseLock } from "./lock.ts";
import { broadcastWorkflowMessageInput, sendWorkflowMessageInput } from "./message.ts";
import { createObservationEmitter } from "./observation.ts";
import {
  cancelWorkflowRun,
  markWorkflowRunPermanentlyFailed,
  releaseStaleWorkflowRunLease,
  rerunWorkflowRun,
  rescheduleWorkflowRun,
  retryFailedWorkflowRun,
  setWorkflowRunAttributes,
  updateWorkflowRunMetadata,
} from "./run-service.ts";
import { readRunResult, retentionCleanupOptions } from "./run-utils.ts";
import {
  resolveScheduleRecord,
  tickSchedules,
  updateScheduleStatus,
  upsertSchedule,
} from "./schedule.ts";
import { createWorkflowEngineStartApi, type WorkflowEngineStartApi } from "./start-api.ts";
import {
  followStreamForRun,
  getStreamInfoForRun,
  readStreamForRun,
  readStreamPageForRun,
  waitForStreamChunkForRun,
  waitForStreamForRun,
  waitForStreamTerminalForRun,
} from "./stream.ts";

type WorkflowEngineObservation = ObservationEmitter;
const MAX_CRYPTO_GET_RANDOM_VALUES_BYTES = 65_536;

type WorkflowEngineMessageEvent = Extract<EventRecord, { readonly kind: "message_sent" }>;

type WorkflowEngineLockReleaseStore = WorkflowLockListerRepository &
  WorkflowLockConditionalWriterRepository;

type WorkflowEngineHookStore = WorkflowRunReaderRepository &
  WorkflowRunConditionalWriterRepository &
  WorkflowMessageIdempotencyIndexLookup &
  WorkflowEventReader &
  WorkflowConditionalEventAppender;

type WorkflowEngineMessageStore = WorkflowRunReaderRepository &
  WorkflowRunConditionalWriterRepository &
  WorkflowRunListerRepository &
  WorkflowMessageIdempotencyIndexLookup &
  WorkflowEventReader &
  WorkflowConditionalEventAppender;

type WorkflowEngineStreamStore = WorkflowRunReaderRepository &
  WorkflowEventReader &
  WorkflowEventHistoryWatcher;

type WorkflowEngineRunServiceStore = WorkflowRunReaderRepository &
  WorkflowRunUnconditionalWriterRepository &
  WorkflowRunConditionalWriterRepository &
  WorkflowEventReader &
  WorkflowStepAttemptLookup &
  WorkflowEngineLockReleaseStore;

interface WorkflowEngineHookService {
  readonly store: WorkflowEngineHookStore;
  readonly now: () => Temporal.Instant;
  readonly limits: WorkflowExecutionLimits;
  readonly emitMessageSent: (runId: RunId, event: WorkflowEngineMessageEvent) => void;
  readonly emitHookResumed: (
    runId: RunId,
    messageId: MessageId,
    payload: StorageValue | undefined,
    traceContext: TelemetryContext | undefined,
  ) => void;
  readonly emitWebhookResumed: (
    runId: RunId,
    messageId: MessageId,
    payload: StorageValue | undefined,
    traceContext: TelemetryContext | undefined,
  ) => void;
  readonly telemetry?: Telemetry;
}

interface WorkflowEngineMessageService {
  readonly store: WorkflowEngineMessageStore;
  readonly now: () => Temporal.Instant;
  readonly limits: WorkflowExecutionLimits;
  readonly observeMessageSent?: (runId: RunId, event: WorkflowEngineMessageEvent) => void;
  readonly telemetry?: Telemetry;
}

interface WorkflowEngineStreamService {
  readonly store: WorkflowEngineStreamStore;
}

interface WorkflowEngineRunService {
  readonly store: WorkflowEngineRunServiceStore;
  readonly now: () => Temporal.Instant;
  readonly limits: {
    readonly maximumPersistedValueBytes?: number;
  };
}

interface WorkflowEngineRunLifecycle {
  readonly emitLifecycleEvent: (
    next: WorkflowRunRecord,
    previous: WorkflowRunRecord,
  ) => void | Promise<void>;
  readonly emitRunMetadataUpdated: (next: WorkflowRunRecord, previous: WorkflowRunRecord) => void;
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

/** Creates workflow engine. */
export function createWorkflowEngine(
  options: CreateWorkflowEngineOptions = {},
): WorkflowEngineContract {
  return new WorkflowEngine(options);
}

/** Storage-backed workflow engine implementation used by the default client and runtime. */
export class WorkflowEngine implements WorkflowEngineContract {
  public readonly storage: WorkflowStorage;
  public readonly store: WorkflowStore;
  readonly #now: () => Temporal.Instant;
  readonly #limits: WorkflowExecutionLimits;
  readonly #logger: Logger;
  readonly #telemetry?: Telemetry;
  readonly #observation: WorkflowEngineObservation;
  readonly #startApi: WorkflowEngineStartApi;
  readonly #executionApi: WorkflowEngineExecutionApi;
  readonly #inspectionApi: WorkflowEngineInspectionApi;
  readonly #hookService: WorkflowEngineHookService;
  readonly #messageService: WorkflowEngineMessageService;
  readonly #streamService: WorkflowEngineStreamService;
  readonly #runService: WorkflowEngineRunService;
  readonly #runLifecycle: WorkflowEngineRunLifecycle;

  constructor(options: CreateWorkflowEngineOptions = {}) {
    if (options.store !== undefined && options.storage !== undefined) {
      WorkflowOptionsError.engineStoreAndStorageConflict();
    }

    const telemetry = options.telemetry === false ? undefined : options.telemetry;
    const storage =
      options.store === undefined
        ? instrumentWorkflowStorage(options.storage ?? createStorage(), telemetry)
        : undefined;
    this.store = options.store ?? createWorkflowStore({ storage });
    this.storage = this.store.storage;
    const now = options.now ?? Temporal.Now.instant;
    this.#now = now;
    const createRunId = options.createRunId ?? createDefaultRunIdFactory(now);
    const createRecordedId =
      options.createRecordedId ?? createDefaultWorkflowRecordedIdFactory(createRunId);
    const createDeterministicRandom =
      options.createDeterministicRandom ?? defaultDeterministicRandom;
    const createDeterministicUuid = options.createDeterministicUuid ?? defaultDeterministicUuid;
    const createDeterministicBytes = options.createDeterministicBytes ?? defaultDeterministicBytes;
    const maximumStepAttemptsPerRun = options.maximumStepAttemptsPerRun ?? 1_000;
    const limits: WorkflowExecutionLimits = {
      maximumPersistedValueBytes: options.maximumPersistedValueBytes,
      maximumEventHistoryEvents: options.maximumEventHistoryEvents,
      maximumStreamChunks: options.maximumStreamChunks,
    };
    this.#limits = limits;

    const readCurrentRunResult = async <TOutput>(runId: RunId): Promise<ExecutionResult<TOutput>> =>
      await readRunResult<TOutput>(this.store, runId, now());

    const logger =
      options.logger === false ? createNoopLogger() : (options.logger ?? createNoopLogger());
    this.#telemetry = telemetry;
    this.#logger = logger;
    const observation = createObservationEmitter(telemetry);
    this.#observation = observation;
    this.#hookService = {
      store: this.store,
      now,
      limits,
      emitMessageSent: observation.emitMessageSent,
      emitHookResumed: observation.emitHookResumed,
      emitWebhookResumed: observation.emitWebhookResumed,
      telemetry,
    };
    this.#messageService = {
      store: this.store,
      now,
      limits,
      observeMessageSent: observation.emitMessageSent,
      telemetry,
    };
    this.#streamService = {
      store: this.store,
    };
    this.#runService = {
      store: this.store,
      now,
      limits,
    };
    const { emitLifecycleEvent, emitResultLifecycleEvent } = createWorkflowLifecycleEmitter(
      options,
      observation,
    );
    this.#runLifecycle = {
      emitLifecycleEvent,
      emitRunMetadataUpdated: observation.emitRunMetadataUpdated,
    };
    this.#inspectionApi = createWorkflowEngineInspectionApi(this.store, now);
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
    this.#executionApi = createWorkflowEngineExecutionApi({
      store: this.store,
      now,
      executionService,
      emitResultLifecycleEvent,
      starter: this,
      resumer: this,
    });
    this.#startApi = createWorkflowEngineStartApi({
      store: this.store,
      now,
      limits,
      createRunId,
      telemetry,
      emitRunEvent: observation.emitRunEvent,
      starter: this,
      handleOperations: {
        getTimeline: async (runId) => await this.getTimeline(runId),
        setMetadata: async (runId, metadata) => await this.updateRunMetadata(runId, metadata),
        setAttributes: async (runId, attributes) => await this.setRunAttributes(runId, attributes),
        cancel: async (runId) => await this.cancelRun(runId),
      },
    });

    try {
      telemetry?.bindEngine?.(this);
    } catch {
      // Telemetry setup failures must not prevent engine creation.
    }
  }

  on<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): ObservationUnsubscribe {
    return this.#observation.on(pattern, handler);
  }

  once<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): ObservationUnsubscribe {
    return this.#observation.once(pattern, handler);
  }

  off<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): void {
    return this.#observation.off(pattern, handler);
  }

  listeners(): readonly ObservationEventHandler[];
  listeners<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
  ): readonly ObservationEventHandler<Pattern>[];
  listeners(pattern?: ObservationEventPattern): readonly ObservationEventHandler[] {
    return pattern === undefined
      ? this.#observation.listeners()
      : this.#observation.listeners(pattern);
  }

  clearListeners(pattern?: ObservationEventPattern): void {
    return this.#observation.clearListeners(pattern);
  }

  listenerCount(pattern?: ObservationEventPattern): number {
    return this.#observation.listenerCount(pattern);
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

  observeWorkerOperation(event: WorkerOperationObservationEvent): void {
    this.#observation.emitWorkerOperation(event);
  }

  observeScheduleRunCreated(event: ScheduleRunCreatedObservationEvent): void {
    this.#observation.emitScheduleRunCreated(event);
  }

  async startWorkflow<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowHandle<TOutput>> {
    return this.#startApi.startWorkflow(workflow, input, options);
  }

  async startWorkflows<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    items: readonly WorkflowBatchStartItem<TRawInput>[],
  ): Promise<readonly WorkflowHandle<TOutput>[]> {
    return this.#startApi.startWorkflows(workflow, items);
  }

  async scheduleNextWorkflow<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options: ScheduleNextOptions,
  ): Promise<WorkflowHandle<TOutput>> {
    return this.#startApi.scheduleNextWorkflow(workflow, input, options);
  }

  async createSchedule<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    scheduleOptions: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord<TInput>> {
    const definition = defineWorkflowFromTarget(workflow);
    const schedule = resolveScheduleRecord(
      this.store.namespace,
      definition,
      scheduleOptions,
      this.#now(),
      this.#limits,
    );
    return this.store.createSchedule(schedule);
  }

  async upsertSchedule<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    scheduleOptions: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord<TInput>> {
    return upsertSchedule(
      this.store,
      defineWorkflowFromTarget(workflow),
      scheduleOptions,
      this.#now(),
      this.#limits,
    );
  }

  async getSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord | undefined> {
    return this.store.getSchedule(scheduleId);
  }

  async listSchedules(options?: ListSchedulesOptions): Promise<readonly ScheduleRecord[]> {
    return this.store.listSchedules(options);
  }

  async listSchedulesPage(
    options?: ListSchedulesPageOptions,
  ): Promise<WorkflowPage<ScheduleRecord>> {
    return this.store.listSchedulesPage(options);
  }

  async pauseSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord> {
    return updateScheduleStatus(this.store, scheduleId, "paused", this.#now());
  }

  async resumeSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord> {
    return updateScheduleStatus(this.store, scheduleId, "active", this.#now());
  }

  async archiveSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord> {
    return updateScheduleStatus(this.store, scheduleId, "archived", this.#now());
  }

  async deleteSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord> {
    return updateScheduleStatus(this.store, scheduleId, "deleted", this.#now());
  }

  async tickSchedules(options?: TickSchedulesOptions): Promise<TickSchedulesResult> {
    const timestamp = options?.now ?? this.#now();
    const tickOptions = options === undefined ? { now: timestamp } : { ...options, now: timestamp };
    const result = await tickSchedules(this.store, this, this.#now, tickOptions);
    this.#observation.emitScheduleTicked({ result, timestamp });
    return result;
  }

  async acquireLock(key: string, options: AcquireLockOptions): Promise<LockRecord> {
    const acquiredAt = options.now === undefined ? this.#now() : options.now;
    return acquireLock(this.store, key, options, acquiredAt);
  }

  async getLock(key: string): Promise<LockRecord | undefined> {
    return this.store.getLock(key);
  }

  async listLocks(): Promise<readonly LockRecord[]> {
    return this.store.listLocks();
  }

  async releaseLock(key: string, options: ReleaseLockOptions): Promise<LockRecord> {
    const releasedAt = options.now === undefined ? this.#now() : options.now;
    return releaseLock(this.store, key, options, releasedAt);
  }

  async releaseStaleLock(key: string, options?: ReleaseStaleLockOptions): Promise<LockRecord> {
    const releasedAt = options?.now === undefined ? this.#now() : options.now;
    return releaseStaleLock(this.store, key, releasedAt);
  }

  async runWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowExecutionOptions,
  ): Promise<WorkflowHandle<TOutput>> {
    return this.#executionApi.runWorkflow(implementation, input, options);
  }

  async runWorkflowNow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowExecutionOptions,
  ): Promise<ExecutionResult<TOutput>> {
    return this.#executionApi.runWorkflowNow(implementation, input, options);
  }

  async resumeWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    runId: RunId,
    options?: WorkflowResumeOptions,
  ): Promise<ExecutionResult<TOutput>> {
    return this.#executionApi.resumeWorkflow(implementation, runId, options);
  }

  async getRun(runId: RunId): Promise<WorkflowRunRecord | undefined> {
    return this.#inspectionApi.getRun(runId);
  }

  async getEvents(runId: RunId): Promise<readonly EventRecord[]> {
    return this.#inspectionApi.getEvents(runId);
  }

  async listEventsPage(runId: RunId, options?: PageOptions): Promise<WorkflowPage<EventRecord>> {
    return this.#inspectionApi.listEventsPage(runId, options);
  }

  async listRuns(options?: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]> {
    return this.#inspectionApi.listRuns(options);
  }

  async listRunsPage(
    options?: WorkflowListRunsPageOptions,
  ): Promise<WorkflowPage<WorkflowRunRecord>> {
    return this.#inspectionApi.listRunsPage(options);
  }

  async countRuns(options?: WorkflowListRunsOptions): Promise<number> {
    return this.#inspectionApi.countRuns(options);
  }

  async getRunSummary(options?: WorkflowRunSummaryOptions): Promise<WorkflowRunSummary> {
    return this.#inspectionApi.getRunSummary(options);
  }

  async getRecoverySummary(
    options?: WorkflowRecoverySummaryOptions,
  ): Promise<WorkflowRecoverySummary> {
    return this.#inspectionApi.getRecoverySummary(options);
  }

  async getTimeline(runId: RunId): Promise<Timeline> {
    return this.#inspectionApi.getTimeline(runId);
  }

  async listStepAttempts(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<readonly WorkflowStepAttemptRecord[]> {
    return this.#inspectionApi.listStepAttempts(runId, options);
  }

  async listStepAttemptsPage(
    runId: RunId,
    options?: WorkflowListStepAttemptsPageOptions,
  ): Promise<WorkflowPage<WorkflowStepAttemptRecord>> {
    return this.#inspectionApi.listStepAttemptsPage(runId, options);
  }

  async countStepAttempts(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<number> {
    return this.#inspectionApi.countStepAttempts(runId, options);
  }

  async repairStepAttempts(runId: RunId): Promise<readonly WorkflowStepAttemptRecord[]> {
    return this.#inspectionApi.repairStepAttempts(runId);
  }

  async repairMessageIdempotencyIndexes(
    runId: RunId,
  ): Promise<readonly WorkflowMessageIdempotencyIndex[]> {
    return this.#inspectionApi.repairMessageIdempotencyIndexes(runId);
  }

  async getStepAttemptSummary(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<WorkflowStepAttemptSummary> {
    return this.#inspectionApi.getStepAttemptSummary(runId, options);
  }

  async cleanupRuns(options: CleanupRunsOptions): Promise<CleanupRunsResult> {
    const result = await this.store.cleanupRuns(options);
    this.#observation.emitCleanupCompleted(result);
    return result;
  }

  async listCleanupMarkers(): Promise<readonly CleanupMarkerRecord[]> {
    return this.store.listCleanupMarkers();
  }

  async applyRetentionPolicy(retentionOptions: RetentionPolicyOptions): Promise<CleanupRunsResult> {
    const result = await this.store.cleanupRuns(
      retentionCleanupOptions(retentionOptions, this.#now),
    );
    this.#observation.emitRetentionApplied(result);
    return result;
  }

  async rerunWorkflow(
    runId: RunId,
    options?: WorkflowRerunOptions,
  ): Promise<WorkflowHandle<unknown>> {
    return rerunWorkflowRun(
      this.#runService,
      async (definition, input, startOptions) =>
        await this.startWorkflow(definition, input, startOptions),
      runId,
      options,
    );
  }

  async rescheduleRun(
    runId: RunId,
    options?: WorkflowRescheduleRunOptions,
  ): Promise<WorkflowRunRecord> {
    return rescheduleWorkflowRun(this.#runService, this.#runLifecycle, runId, options);
  }

  async releaseStaleRunLease(
    runId: RunId,
    options?: WorkflowReleaseStaleLeaseOptions,
  ): Promise<WorkflowRunRecord> {
    return releaseStaleWorkflowRunLease(this.#runService, this.#runLifecycle, runId, options);
  }

  async retryFailedRun(
    runId: RunId,
    options?: WorkflowRetryFailedRunOptions,
  ): Promise<WorkflowRunRecord> {
    return retryFailedWorkflowRun(this.#runService, this.#runLifecycle, runId, options);
  }

  async markRunPermanentlyFailed(
    runId: RunId,
    options: WorkflowMarkRunPermanentlyFailedOptions,
  ): Promise<WorkflowRunRecord> {
    return markWorkflowRunPermanentlyFailed(this.#runService, this.#runLifecycle, runId, options);
  }

  async updateRunMetadata(runId: RunId, metadata: unknown): Promise<WorkflowRunRecord> {
    return updateWorkflowRunMetadata(this.#runService, this.#runLifecycle, runId, metadata);
  }

  async setRunAttributes(
    runId: RunId,
    attributes: WorkflowAttributePatch,
  ): Promise<WorkflowRunRecord> {
    return setWorkflowRunAttributes(this.#runService, runId, attributes);
  }

  async cancelRun(runId: RunId): Promise<WorkflowRunRecord> {
    return cancelWorkflowRun(this.#runService, this.#runLifecycle, runId);
  }

  async resumeHook(token: string, options?: ResumeHookOptions): Promise<void> {
    await resumeHook(token, options, this.#hookService);
  }

  async resumeWebhook(token: string, options?: ResumeWebhookOptions): Promise<void> {
    await resumeWebhook(token, options, this.#hookService);
  }

  async disposeHook(token: string): Promise<HookInspection> {
    return disposeHook(token, this.#hookService);
  }

  async disposeWebhook(token: string): Promise<HookInspection> {
    return disposeWebhook(token, this.#hookService);
  }

  async getHookByToken(token: string): Promise<HookInspection> {
    return getHookByToken(token, this.store, this.#now());
  }

  async getStreamInfo(runId: RunId, streamIdOrName: StreamIdOrName): Promise<StreamInfo> {
    return getStreamInfoForRun(this.#streamService, runId, streamIdOrName);
  }

  followStream<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    followOptions?: FollowStreamOptions,
  ): AsyncIterable<StreamUpdate<TChunk>> {
    return followStreamForRun<TChunk>(this.#streamService, runId, streamIdOrName, followOptions);
  }

  async waitForStream(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    waitOptions?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined> {
    return waitForStreamForRun(this.#streamService, runId, streamIdOrName, waitOptions);
  }

  async waitForStreamChunk<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    afterIndex: number,
    waitOptions?: WaitStreamOptions,
  ): Promise<StreamChunk<TChunk> | undefined> {
    return waitForStreamChunkForRun<TChunk>(
      this.#streamService,
      runId,
      streamIdOrName,
      afterIndex,
      waitOptions,
    );
  }

  async waitForStreamTerminal(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    waitOptions?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined> {
    return waitForStreamTerminalForRun(this.#streamService, runId, streamIdOrName, waitOptions);
  }

  async readStream<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    readOptions?: ReadStreamOptions,
  ): Promise<StreamState<TChunk>> {
    return readStreamForRun<TChunk>(this.#streamService, runId, streamIdOrName, readOptions);
  }

  async readStreamPage<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    readOptions?: ReadStreamPageOptions,
  ): Promise<StreamPage<TChunk>> {
    return readStreamPageForRun<TChunk>(this.#streamService, runId, streamIdOrName, readOptions);
  }

  async sendMessage<TPayload, TKey = void>(
    runId: RunId,
    messageInput: SendMessageInput | MessageChannel<TPayload, TKey>,
    channelOptions?: SendMessageChannelOptions<TPayload, TKey>,
  ) {
    await sendWorkflowMessageInput(this.#messageService, runId, messageInput, channelOptions);
  }

  async broadcastMessage<TPayload, TKey = void>(
    messageInput: BroadcastMessageInput | MessageChannel<TPayload, TKey>,
    channelOptions?: BroadcastMessageChannelOptions<TPayload, TKey>,
  ) {
    return broadcastWorkflowMessageInput(this.#messageService, messageInput, channelOptions);
  }
}
