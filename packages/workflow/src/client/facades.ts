import type {
  WorkflowClientAdminApi,
  WorkflowClientHooksApi,
  WorkflowClientLocksApi,
  WorkflowClientMessagesApi,
  WorkflowClientRunsApi,
  WorkflowClientSchedulesApi,
  WorkflowClientStreamsApi,
  WorkflowClientWorkersApi,
  WorkflowRunHandle,
} from "../types/client.ts";
import type { RegistryLike, WorkflowStartTarget } from "../types/definition.ts";
import type {
  WorkflowCleanupAdmin,
  WorkflowHookManager,
  LockManager,
  WorkflowMessageSender,
  WorkflowRunHandleReader,
  WorkflowRunMaintenance,
  WorkflowRunReader,
  WorkflowRunRerunner,
  WorkflowScheduler,
  WorkflowStarter,
  WorkflowStepAttemptReader,
  WorkflowStreamReader,
  WorkflowWorkerEngine,
} from "../types/engine.ts";
import type {
  BroadcastMessageChannelOptions,
  BroadcastMessageInput,
  BroadcastMessageResult,
  MessageChannel,
  SendMessageChannelOptions,
  SendMessageInput,
} from "../types/message.ts";
import type {
  WorkflowBatchStartItem,
  WorkflowRunArguments,
  ScheduleNextOptions,
  WorkflowStartOptions,
} from "../types/run-options.ts";
import type { RunId } from "../types/run.ts";

import { createWorkflowRunHandle } from "../client/run-handle.ts";
import {
  workerOptionsFromClientOptions,
  workerOptionsFromWakeOptions,
} from "../client/worker-options.ts";
import { defineWorkflowFromName, defineWorkflowFromTarget } from "../definition.ts";
import { resolveScheduleNextOptions } from "../engine/start-api.ts";
import { WorkflowCapabilityError } from "../errors/capability.ts";
import { resolveBroadcastMessageInput, resolveSendMessageInput } from "../message-options.ts";
import { resolvePositiveSafeIntegerOption } from "../utility.ts";
import { WorkflowWorker } from "../worker.ts";

type WorkflowRunHandleEngine = WorkflowRunMaintenance &
  WorkflowRunHandleReader &
  WorkflowStreamReader;
type WorkflowClientRunsEngine = WorkflowStarter &
  WorkflowRunReader &
  WorkflowRunHandleEngine &
  WorkflowStepAttemptReader;
type WorkflowClientAdminEngine = WorkflowCleanupAdmin &
  WorkflowRunRerunner &
  WorkflowRunHandleEngine;
type WorkflowClientSchedulesEngine = WorkflowRunHandleEngine & WorkflowScheduler;
type WorkflowWorkerEngineAccessor = () => WorkflowWorkerEngine | undefined;
type WorkflowRegistryAccessor = () => RegistryLike;
type WorkflowClockAccessor = () => Temporal.Instant;

function requireWorkflowWorkerEngine(
  engine: WorkflowWorkerEngine | undefined,
): WorkflowWorkerEngine {
  if (engine === undefined) {
    WorkflowCapabilityError.unsupported("workflow worker engine");
  }
  return engine;
}

export function createWorkflowClientRunsApi(
  getEngine: () => WorkflowClientRunsEngine,
  now: WorkflowClockAccessor,
): WorkflowClientRunsApi {
  return {
    async start<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
      ...runArgs: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
    ) {
      const [input, runOptions] = runArgs as [TRawInput, WorkflowStartOptions | undefined];
      const definition = defineWorkflowFromTarget(workflow);
      const handle = await getEngine().startWorkflow(definition, input, runOptions);
      return createWorkflowRunHandle<TOutput>(getEngine(), definition, handle.runId, now);
    },
    async startBatch<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
      items: readonly WorkflowBatchStartItem<TRawInput>[],
    ) {
      const definition = defineWorkflowFromTarget(workflow);
      const handles = await getEngine().startWorkflows(definition, items);
      return handles.map((handle: { readonly runId: RunId }) =>
        createWorkflowRunHandle<TOutput>(getEngine(), definition, handle.runId, now),
      );
    },
    get: async (runId: RunId) => await getEngine().getRun(runId),
    events: async (runId: RunId) => await getEngine().getEvents(runId),
    eventsPage: async (runId, options) => await getEngine().listEventsPage(runId, options),
    list: async (options) => await getEngine().listRuns(options),
    page: async (options) => await getEngine().listRunsPage(options),
    count: async (options) => await getEngine().countRuns(options),
    summary: async (options) => await getEngine().getRunSummary(options),
    recovery: async (options) => await getEngine().getRecoverySummary(options),
    timeline: async (runId) => await getEngine().getTimeline(runId),
    listStepAttempts: async (runId, options) => await getEngine().listStepAttempts(runId, options),
    listStepAttemptsPage: async (runId, options) =>
      await getEngine().listStepAttemptsPage(runId, options),
    countStepAttempts: async (runId, options) =>
      await getEngine().countStepAttempts(runId, options),
    stepAttemptSummary: async (runId, options) =>
      await getEngine().getStepAttemptSummary(runId, options),
  };
}

export function createWorkflowClientAdminApi(
  getEngine: () => WorkflowClientAdminEngine,
  now: WorkflowClockAccessor,
): WorkflowClientAdminApi {
  return {
    cleanup: async (options) => await getEngine().cleanupRuns(options),
    cleanupMarkers: async () => await getEngine().listCleanupMarkers(),
    applyRetentionPolicy: async (options) => await getEngine().applyRetentionPolicy(options),
    rerun: async (runId, options): Promise<WorkflowRunHandle<unknown>> => {
      const handle = await getEngine().rerunWorkflow(runId, options);
      return createWorkflowRunHandle(
        getEngine(),
        defineWorkflowFromName(handle.workflowName, handle.workflowVersion),
        handle.runId,
        now,
      );
    },
    reschedule: async (runId, options) => await getEngine().rescheduleRun(runId, options),
    releaseStaleLease: async (runId, options) =>
      await getEngine().releaseStaleRunLease(runId, options),
    retryFailed: async (runId, options) => await getEngine().retryFailedRun(runId, options),
    markPermanentlyFailed: async (runId, options) =>
      await getEngine().markRunPermanentlyFailed(runId, options),
    updateMetadata: async (runId, metadata) => await getEngine().updateRunMetadata(runId, metadata),
    setAttributes: async (runId, attributes) =>
      await getEngine().setRunAttributes(runId, attributes),
    cancel: async (runId) => await getEngine().cancelRun(runId),
  };
}

export function createWorkflowClientSchedulesApi(
  getEngine: () => WorkflowClientSchedulesEngine,
  now: WorkflowClockAccessor,
): WorkflowClientSchedulesApi {
  return {
    async next<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
      input: TRawInput,
      scheduleOptions: ScheduleNextOptions,
    ) {
      const definition = defineWorkflowFromTarget(workflow);
      const options = resolveScheduleNextOptions(scheduleOptions, now);
      const handle = await getEngine().scheduleNextWorkflow(definition, input, options.schedule);
      return createWorkflowRunHandle<TOutput>(getEngine(), definition, handle.runId, now);
    },
    create: async (workflow, options) => await getEngine().createSchedule(workflow, options),
    upsert: async (workflow, options) => await getEngine().upsertSchedule(workflow, options),
    get: async (scheduleId) => await getEngine().getSchedule(scheduleId),
    list: async (options) => await getEngine().listSchedules(options),
    page: async (options) => await getEngine().listSchedulesPage(options),
    pause: async (scheduleId) => await getEngine().pauseSchedule(scheduleId),
    resume: async (scheduleId) => await getEngine().resumeSchedule(scheduleId),
    archive: async (scheduleId) => await getEngine().archiveSchedule(scheduleId),
    delete: async (scheduleId) => await getEngine().deleteSchedule(scheduleId),
    tick: async (options) => await getEngine().tickSchedules(options),
  };
}

export function createWorkflowClientLocksApi(getEngine: () => LockManager): WorkflowClientLocksApi {
  return {
    acquire: async (key, options) => await getEngine().acquireLock(key, options),
    get: async (key) => await getEngine().getLock(key),
    list: async () => await getEngine().listLocks(),
    release: async (key, options) => await getEngine().releaseLock(key, options),
    releaseStale: async (key, options) => await getEngine().releaseStaleLock(key, options),
  };
}

export function createWorkflowClientHooksApi(
  getEngine: () => WorkflowHookManager,
): WorkflowClientHooksApi {
  return {
    resume: async (token, options) => await getEngine().resumeHook(token, options),
    resumeWebhook: async (token, options) => await getEngine().resumeWebhook(token, options),
    dispose: async (token) => await getEngine().disposeHook(token),
    disposeWebhook: async (token) => await getEngine().disposeWebhook(token),
    getByToken: async (token) => await getEngine().getHookByToken(token),
  };
}

export function createWorkflowClientStreamsApi(
  getEngine: () => WorkflowStreamReader,
): WorkflowClientStreamsApi {
  return {
    getInfo: async (runId, streamIdOrName) =>
      await getEngine().getStreamInfo(runId, streamIdOrName),
    follow: (runId, streamIdOrName, options) =>
      getEngine().followStream(runId, streamIdOrName, options),
    wait: async (runId, streamIdOrName, options) =>
      await getEngine().waitForStream(runId, streamIdOrName, options),
    waitForChunk: async (runId, streamIdOrName, afterIndex, options) =>
      await getEngine().waitForStreamChunk(runId, streamIdOrName, afterIndex, options),
    waitForTerminal: async (runId, streamIdOrName, options) =>
      await getEngine().waitForStreamTerminal(runId, streamIdOrName, options),
    read: async (runId, streamIdOrName, options) =>
      await getEngine().readStream(runId, streamIdOrName, options),
    readPage: async (runId, streamIdOrName, options) =>
      await getEngine().readStreamPage(runId, streamIdOrName, options),
  };
}

export function createWorkflowClientMessagesApi(
  getEngine: () => WorkflowMessageSender,
): WorkflowClientMessagesApi {
  return {
    async send<TPayload, TKey = void>(
      runId: RunId,
      messageInput: SendMessageInput | MessageChannel<TPayload, TKey>,
      channelOptions?: SendMessageChannelOptions<TPayload, TKey>,
    ) {
      const options = await resolveSendMessageInput(messageInput, channelOptions);
      await getEngine().sendMessage(runId, options);
    },
    async broadcast<TPayload, TKey = void>(
      messageInput: BroadcastMessageInput | MessageChannel<TPayload, TKey>,
      channelOptions?: BroadcastMessageChannelOptions<TPayload, TKey>,
    ): Promise<BroadcastMessageResult> {
      const options = await resolveBroadcastMessageInput(messageInput, channelOptions);
      return getEngine().broadcastMessage(options);
    },
  };
}

export function createWorkflowClientWorkersApi(
  getEngine: WorkflowWorkerEngineAccessor,
  getRegistry: WorkflowRegistryAccessor,
  now: WorkflowClockAccessor,
): WorkflowClientWorkersApi {
  return {
    create: (options) => {
      const engine = requireWorkflowWorkerEngine(getEngine());
      return new WorkflowWorker(
        workerOptionsFromClientOptions(engine, getRegistry(), now, options),
      );
    },
    processRun: async (runId, options) => {
      const engine = requireWorkflowWorkerEngine(getEngine());
      const worker = new WorkflowWorker(
        workerOptionsFromClientOptions(
          engine,
          getRegistry(),
          now,
          workerOptionsFromWakeOptions(options),
        ),
      );
      await worker.processRun(runId);
    },
    wakeDueRuns: async (options) => {
      const engine = requireWorkflowWorkerEngine(getEngine());
      const worker = new WorkflowWorker(
        workerOptionsFromClientOptions(
          engine,
          getRegistry(),
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
