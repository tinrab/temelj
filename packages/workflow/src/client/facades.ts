import { isFunction } from "@temelj/value";

import type { WorkflowEngine } from "../engine/create.ts";
import type {
  ClientAdminApi,
  ClientHooksApi,
  ClientLocksApi,
  ClientMessagesApi,
  ClientRunsApi,
  ClientSchedulesApi,
  ClientStreamsApi,
  ClientWorkersApi,
  WorkflowRunHandle,
  CompiledWorkflowFunction,
} from "../types/client.ts";
import type {
  WorkflowDefinition,
  WorkflowImplementation,
  RegistryLike,
  StartTarget,
} from "../types/definition.ts";
import type { RunId } from "../types/ids.ts";
import type {
  BroadcastMessageChannelOptions,
  BroadcastMessageInput,
  BroadcastMessageResult,
  MessageChannel,
  SendMessageChannelOptions,
  SendMessageInput,
} from "../types/message.ts";
import type {
  BatchStartItem,
  RunArguments,
  ScheduleNextOptions,
  StartOptions,
} from "../types/run-options.ts";

import { createRunHandle } from "../client/run-handle.ts";
import {
  workerOptionsFromClientOptions,
  workerOptionsFromWakeOptions,
} from "../client/worker-options.ts";
import { getCompiledDefinition } from "../compiled-function.ts";
import { defineFromTarget } from "../definition.ts";
import { disposeHook, getHookByToken, resumeHook } from "../engine/hooks.ts";
import {
  countRunStepAttempts,
  getRunStepAttemptSummary,
  getRunTimeline,
  getWorkflowRecoverySummary,
  pageRunStepAttempts,
} from "../engine/inspection.ts";
import { releaseStaleLock } from "../engine/lock.ts";
import { broadcastMessageInput, sendMessageInput } from "../engine/message.ts";
import {
  applyRetentionPolicy,
  cancelWorkflowRun,
  cleanupRuns,
  markWorkflowRunPermanentlyFailed,
  releaseStaleWorkflowRunLease,
  rescheduleWorkflowRun,
  retryFailedWorkflowRun,
  setRunAttributes,
  updateWorkflowRunMetadata,
} from "../engine/run-service.ts";
import { updateScheduleStatus, upsertSchedule } from "../engine/schedule.ts";
import { resolveScheduleNextOptions } from "../engine/start.ts";
import {
  followStream,
  getStreamInfo,
  readStream,
  waitForStream,
  waitForStreamChunk,
  waitForStreamTerminal,
} from "../engine/stream-reader.ts";
import { WorkflowDefinitionError } from "../errors/mod.ts";
import { resolvePositiveSafeIntegerOption } from "../values.ts";
import { WorkflowWorker } from "../worker/worker.ts";

type ClockAccessor = () => Temporal.Instant;

export function createClientRunsApi(
  engine: WorkflowEngine,
  now: ClockAccessor,
  registry: RegistryLike,
): ClientRunsApi {
  const register = <TInput, TOutput, TRawInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void => {
    if (registry.get(implementation.definition) === undefined) {
      registry.register(implementation);
    }
  };

  async function start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowDefinition<TInput, TOutput, TRawInput>,
    ...args: RunArguments<TRawInput, StartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  async function start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowImplementation<TInput, TOutput, TRawInput>,
    ...args: RunArguments<TRawInput, StartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  async function start<TArgs extends readonly unknown[], TOutput>(
    workflow: CompiledWorkflowFunction<TArgs, TOutput>,
    ...args: TArgs
  ): Promise<WorkflowRunHandle<Awaited<TOutput>>>;
  async function start(
    workflow: StartTarget | Function,
    ...args: unknown[]
  ): Promise<WorkflowRunHandle<unknown>> {
    if (isFunction(workflow)) {
      const implementation = getCompiledDefinition(workflow);

      if (implementation === undefined) {
        WorkflowDefinitionError.compiledMetadataMissing();
      }

      register(implementation);
      const handle = await engine.startWorkflow(implementation.definition, args);

      return createRunHandle(engine, handle, now);
    }

    if (workflow.kind === "implementation") {
      register(workflow);
    }

    // SAFETY: Both non-function overloads take the input, then optional start options.
    const [input, options] = args as [unknown, StartOptions?];
    const handle = await engine.startWorkflow(defineFromTarget(workflow), input, options);

    return createRunHandle(engine, handle, now);
  }

  return {
    start,
    getHandle: async (runId) => createRunHandle(engine, await engine.getRunRef(runId), now),
    async startBatch<TInput, TOutput, TRawInput = TInput>(
      workflow: StartTarget<TInput, TOutput, TRawInput>,
      items: readonly BatchStartItem<TRawInput>[],
    ) {
      const definition = defineFromTarget(workflow);
      const handles = await engine.startWorkflows(definition, items);

      return handles.map((handle) => createRunHandle(engine, handle, now));
    },
    get: (runId: RunId) => engine.store.getRun(runId),
    events: (runId: RunId) => engine.store.getEvents(runId),
    list: (options) => engine.store.listRunsPage(options),
    count: (options) => engine.store.countRuns(options),
    summary: (options) => engine.getRunSummary(options),
    recoverySummary: (options) =>
      getWorkflowRecoverySummary({
        store: engine.store,
        now: engine.context.now(),
        filters: options,
      }),
    timeline: (runId) => getRunTimeline(engine.context, runId),
    listStepAttempts: (runId, options) => pageRunStepAttempts(engine.context, runId, options),
    countStepAttempts: (runId, options) => countRunStepAttempts(engine.context, runId, options),
    stepAttemptSummary: (runId, options) =>
      getRunStepAttemptSummary(engine.context, runId, options),
  };
}

export function createClientAdminApi(engine: WorkflowEngine, now: ClockAccessor): ClientAdminApi {
  return {
    cleanup: (options) => cleanupRuns(engine.context, options),
    cleanupMarkers: () => engine.store.listCleanupMarkers(),
    applyRetentionPolicy: (options) => applyRetentionPolicy(engine.context, options),
    rerun: async (runId, options): Promise<WorkflowRunHandle<unknown>> => {
      const handle = await engine.rerunWorkflow(runId, options);

      return createRunHandle(engine, handle, now);
    },
    reschedule: (runId, options) =>
      rescheduleWorkflowRun(engine.context, engine.lifecycle, runId, options),
    releaseStaleLease: (runId, options) =>
      releaseStaleWorkflowRunLease(engine.context, engine.lifecycle, runId, options),
    retryFailed: (runId, options) =>
      retryFailedWorkflowRun(engine.context, engine.lifecycle, runId, options),
    markPermanentlyFailed: (runId, options) =>
      markWorkflowRunPermanentlyFailed(engine.context, engine.lifecycle, runId, options),
    setMetadata: (runId, metadata) =>
      updateWorkflowRunMetadata(engine.context, engine.lifecycle, runId, metadata),
    setAttributes: (runId, attributes) => setRunAttributes(engine.context, runId, attributes),
    cancel: (runId) => cancelWorkflowRun(engine.context, engine.lifecycle, runId),
  };
}

export function createClientSchedulesApi(
  engine: WorkflowEngine,
  now: ClockAccessor,
): ClientSchedulesApi {
  return {
    async next<TInput, TOutput, TRawInput = TInput>(
      workflow: StartTarget<TInput, TOutput, TRawInput>,
      input: TRawInput,
      scheduleOptions: ScheduleNextOptions,
    ) {
      const definition = defineFromTarget(workflow);
      const options = resolveScheduleNextOptions(scheduleOptions, now);
      const handle = await engine.scheduleNextWorkflow(definition, input, options.schedule);

      return createRunHandle(engine, handle, now);
    },
    create: (workflow, options) => engine.createSchedule(workflow, options),
    upsert: (workflow, options) =>
      upsertSchedule(
        engine.store,
        defineFromTarget(workflow),
        options,
        engine.context.now(),
        engine.context.limits,
      ),
    get: (scheduleId) => engine.store.getSchedule(scheduleId),
    list: (options) => engine.store.listSchedulesPage(options),
    pause: (scheduleId) =>
      updateScheduleStatus(engine.store, scheduleId, "paused", engine.context.now()),
    resume: (scheduleId) =>
      updateScheduleStatus(engine.store, scheduleId, "active", engine.context.now()),
    archive: (scheduleId) =>
      updateScheduleStatus(engine.store, scheduleId, "archived", engine.context.now()),
    delete: (scheduleId) =>
      updateScheduleStatus(engine.store, scheduleId, "deleted", engine.context.now()),
    tick: (options) => engine.tickSchedules(options),
  };
}

export function createClientLocksApi(engine: WorkflowEngine): ClientLocksApi {
  return {
    acquire: (key, options) => engine.acquireLock(key, options),
    get: (key) => engine.store.getLock(key),
    list: () => engine.store.listLocks(),
    release: (key, options) => engine.releaseLock(key, options),
    releaseStale: (key, options) =>
      releaseStaleLock(engine.store, key, options?.now ?? engine.context.now()),
  };
}

export function createClientHooksApi(engine: WorkflowEngine): ClientHooksApi {
  return {
    resume: (token, options) => resumeHook(token, options, engine.context),
    dispose: (token) => disposeHook(token, engine.context),
    getByToken: (token) => getHookByToken(token, engine.store, engine.context.now()),
  };
}

export function createClientStreamsApi(engine: WorkflowEngine): ClientStreamsApi {
  return {
    getInfo: (runId, streamIdOrName) => getStreamInfo(engine.context, runId, streamIdOrName),
    follow: (runId, streamIdOrName, options) =>
      followStream(engine.context, runId, streamIdOrName, options),
    wait: (runId, streamIdOrName, options) =>
      waitForStream(engine.context, runId, streamIdOrName, options),
    waitForChunk: (runId, streamIdOrName, afterIndex, options) =>
      waitForStreamChunk(engine.context, runId, streamIdOrName, afterIndex, options),
    waitForTerminal: (runId, streamIdOrName, options) =>
      waitForStreamTerminal(engine.context, runId, streamIdOrName, options),
    read: (runId, streamIdOrName, options) =>
      readStream(engine.context, runId, streamIdOrName, options),
  };
}

export function createClientMessagesApi(engine: WorkflowEngine): ClientMessagesApi {
  return {
    async send<TPayload, TRawPayload = TPayload>(
      runId: RunId,
      messageInput: SendMessageInput | MessageChannel<TPayload, TRawPayload>,
      channelOptions?: SendMessageChannelOptions<TRawPayload>,
    ) {
      await sendMessageInput(engine.context, runId, messageInput, channelOptions);
    },
    async broadcast<TPayload, TRawPayload = TPayload>(
      messageInput: BroadcastMessageInput | MessageChannel<TPayload, TRawPayload>,
      channelOptions?: BroadcastMessageChannelOptions<TRawPayload>,
    ): Promise<BroadcastMessageResult> {
      return await broadcastMessageInput(engine.context, messageInput, channelOptions);
    },
  };
}

export function createClientWorkersApi(
  engine: WorkflowEngine,
  registry: RegistryLike,
  now: ClockAccessor,
): ClientWorkersApi {
  return {
    create: (options) => {
      return new WorkflowWorker(workerOptionsFromClientOptions(engine, registry, now, options));
    },
    processRun: async (runId, options) => {
      const worker = new WorkflowWorker(
        workerOptionsFromClientOptions(
          engine,
          registry,
          now,
          workerOptionsFromWakeOptions(options),
        ),
      );

      await worker.processRun(runId);
    },
    wakeDueRuns: async (options) => {
      const worker = new WorkflowWorker(
        workerOptionsFromClientOptions(
          engine,
          registry,
          now,
          workerOptionsFromWakeOptions(options),
        ),
      );

      const filters = options === undefined ? {} : options;

      const maxRuns =
        resolvePositiveSafeIntegerOption(options?.maxRuns, "Workflow worker maxRuns") ?? 1;

      let processedRuns = 0;

      while (options?.signal?.aborted !== true && processedRuns < maxRuns) {
        const result = await worker.processNextRun(filters);

        if (result === undefined) {
          break;
        }

        processedRuns++;
      }

      return { processedRuns };
    },
  };
}
