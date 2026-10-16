import type { Unsubscribe } from "@temelj/event";
import type { StorageValue } from "@temelj/storage";

import type { COMPILED_WORKFLOW, COMPILED_STEP } from "../compiled-function.ts";
import type {
  CleanupMarkerRecord,
  CleanupRunsOptions,
  CleanupRunsResult,
  RetentionPolicyOptions,
} from "./cleanup.ts";
import type { WorkflowDefinition, WorkflowImplementation, StartTarget } from "./definition.ts";
import type { EventRecord } from "./events.ts";
import type { HookInspection, ResumeHookOptions } from "./hook.ts";
import type { RunId, StreamIdOrName, WorkerId } from "./ids.ts";
import type {
  AcquireLockOptions,
  LockRecord,
  ReleaseLockOptions,
  ReleaseStaleLockOptions,
} from "./lock.ts";
import type {
  BroadcastMessageChannelOptions,
  BroadcastMessageInput,
  BroadcastMessageResult,
  MessageChannel,
  MessageSender,
} from "./message.ts";
import type { ObservationEventHandler, ObservationEventPattern } from "./observation.ts";
import type { WorkflowPage } from "./pagination.ts";
import type { MissingImplementationRetryConfig } from "./retry.ts";
import type {
  ListRunsOptions,
  ListRunsPageOptions,
  ListStepAttemptsPageOptions,
} from "./run-list.ts";
import type {
  BatchStartItem,
  MarkRunPermanentlyFailedOptions,
  ReleaseStaleLeaseOptions,
  RerunOptions,
  RescheduleRunOptions,
  RetryFailedRunOptions,
  RunArguments,
  ScheduleNextOptions,
  StartOptions,
} from "./run-options.ts";
import type { AttributePatch, RunRecord } from "./run.ts";
import type { RunHandle, RuntimeRunsApi, WorkflowRuntime } from "./runtime.ts";
import type {
  ScheduleId,
  ListSchedulesPageOptions,
  ScheduleConfig,
  ScheduleRecord,
  TickSchedulesOptions,
  TickSchedulesResult,
} from "./schedule.ts";
import type {
  ListStepAttemptsOptions,
  StepAttemptRecord,
  StepAttemptSummary,
} from "./step-attempts.ts";
import type { StepDefinition } from "./step.ts";
import type {
  FollowStreamOptions,
  ReadStreamOptions,
  StreamChunk,
  StreamInfo,
  StreamState,
  StreamUpdate,
  WaitStreamOptions,
} from "./stream.ts";
import type { RecoverySummary, RunSummary } from "./summary.ts";
import type { Timeline } from "./timeline.ts";
import type {
  WakeDueRunsOptions,
  WorkflowWorker,
  WorkerRunFilterOptions,
  WorkerRunResult,
} from "./worker.ts";
/** Function shape emitted by the directive compiler for workflow and step functions. */

export type CompiledWorkflowFunction<TArgs extends readonly unknown[], TOutput> = ((
  ...args: TArgs
) => Promise<TOutput> | TOutput) & {
  readonly [COMPILED_WORKFLOW]?: WorkflowImplementation<TArgs, Awaited<TOutput>, TArgs>;
  readonly [COMPILED_STEP]?: StepDefinition<TArgs, Awaited<TOutput>>;
};

/** A local run handle: the portable operations plus history, streams, metadata, and attributes. */
export interface WorkflowRunHandle<TOutput = unknown> extends RunHandle<TOutput> {
  /** Returns all durable events recorded for the run. */
  events(): Promise<readonly EventRecord[]>;
  /** Returns a timeline projection of the run's event history. */
  timeline(): Promise<Timeline>;
  /** Durable stream reads for this run. */
  readonly streams: RunStreamsApi;
  /** Replaces this run's metadata value. */
  setMetadata(metadata: StorageValue): Promise<RunRecord>;
  /** Applies an attribute patch to this run. */
  setAttributes(attributes: AttributePatch): Promise<RunRecord>;
}

/** Durable stream reads for one run: the operations of `client.streams`, without the run ID. */
export interface RunStreamsApi {
  getInfo(streamIdOrName: StreamIdOrName): Promise<StreamInfo>;
  follow(
    streamIdOrName: StreamIdOrName,
    options?: FollowStreamOptions,
  ): AsyncIterable<StreamUpdate>;
  wait(
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  waitForChunk(
    streamIdOrName: StreamIdOrName,
    afterIndex: number,
    options?: WaitStreamOptions,
  ): Promise<StreamChunk | undefined>;
  waitForTerminal(
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  read(streamIdOrName: StreamIdOrName, options?: ReadStreamOptions): Promise<StreamState>;
}

export interface WorkflowClient extends WorkflowRuntime {
  /** Subscribes to run lifecycle and operation events, such as `workflow:run-completed`. */
  on<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): Unsubscribe;
  once<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): Unsubscribe;
  off<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): void;
  /** Grouped run inspection and history operations. */
  readonly runs: ClientRunsApi;
  /** Grouped administrative run maintenance operations. */
  readonly admin: ClientAdminApi;
  /** Grouped schedule management operations. */
  readonly schedules: ClientSchedulesApi;
  readonly locks: ClientLocksApi;
  /** Grouped external resume hook operations. */
  readonly hooks: ClientHooksApi;
  /** Grouped durable stream read operations. */
  readonly streams: ClientStreamsApi;
  /** Grouped message send operations. */
  readonly messages: ClientMessagesApi;
  /** Grouped worker creation and wake operations. */
  readonly workers: ClientWorkersApi;
}

export interface ClientRunsApi extends RuntimeRunsApi {
  /** Starts a run of a definition. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowDefinition<TInput, TOutput, TRawInput>,
    ...args: RunArguments<TRawInput, StartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  /** Registers an implementation when needed, then starts a run of it. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowImplementation<TInput, TOutput, TRawInput>,
    ...args: RunArguments<TRawInput, StartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  /** Starts a compiled workflow function produced by the workflow transform. */
  start<TArgs extends readonly unknown[], TOutput>(
    workflow: CompiledWorkflowFunction<TArgs, TOutput>,
    ...args: TArgs
  ): Promise<WorkflowRunHandle<Awaited<TOutput>>>;
  /** A handle for an existing run. A run ID does not establish its output type, so validate the result. */
  getHandle(runId: RunId): Promise<WorkflowRunHandle<StorageValue | undefined>>;
  list(options?: ListRunsPageOptions): Promise<WorkflowPage<RunRecord>>;
  /** Starts multiple workflow runs for the same definition. */
  startBatch<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    items: readonly BatchStartItem<TRawInput>[],
  ): Promise<readonly WorkflowRunHandle<TOutput>[]>;
  /** Returns a workflow run by ID, if it exists. */
  get(runId: RunId): Promise<RunRecord | undefined>;
  /** Returns all durable events recorded for a run. */
  events(runId: RunId): Promise<readonly EventRecord[]>;
  /** Counts workflow runs matching optional filters. */
  count(options?: ListRunsOptions): Promise<number>;
  /** Returns aggregate run metrics for runs matching optional filters. */
  summary(options?: ListRunsOptions): Promise<RunSummary>;
  /** Returns recovery-oriented aggregate metrics for runs matching optional filters. */
  recoverySummary(options?: ListRunsOptions): Promise<RecoverySummary>;
  timeline(runId: RunId): Promise<Timeline>;
  listStepAttempts(
    runId: RunId,
    options?: ListStepAttemptsPageOptions,
  ): Promise<WorkflowPage<StepAttemptRecord>>;
  countStepAttempts(runId: RunId, options?: ListStepAttemptsOptions): Promise<number>;
  /** Returns aggregate step-attempt metrics for a run. */
  stepAttemptSummary(runId: RunId, options?: ListStepAttemptsOptions): Promise<StepAttemptSummary>;
}

export interface ClientAdminApi {
  /** Deletes terminal run data according to cleanup options. */
  cleanup(options: CleanupRunsOptions): Promise<CleanupRunsResult>;
  cleanupMarkers(): Promise<readonly CleanupMarkerRecord[]>;
  /** Deletes terminal run data according to a retention policy. */
  applyRetentionPolicy(options: RetentionPolicyOptions): Promise<CleanupRunsResult>;
  /** Creates a new run from an existing run record and returns its handle. */
  rerun(runId: RunId, options?: RerunOptions): Promise<WorkflowRunHandle<unknown>>;
  /** Moves a run back to pending at an optional new availability time. */
  reschedule(runId: RunId, options?: RescheduleRunOptions): Promise<RunRecord>;
  /** Releases a run's worker lease when it is stale. */
  releaseStaleLease(runId: RunId, options?: ReleaseStaleLeaseOptions): Promise<RunRecord>;
  retryFailed(runId: RunId, options?: RetryFailedRunOptions): Promise<RunRecord>;
  /** Marks a workflow run as permanently failed with an operator reason. */
  markPermanentlyFailed(runId: RunId, options: MarkRunPermanentlyFailedOptions): Promise<RunRecord>;
  /** Replaces a workflow run's metadata value. */
  setMetadata(runId: RunId, metadata: StorageValue): Promise<RunRecord>;
  /** Applies an attribute patch to a workflow run. */
  setAttributes(runId: RunId, attributes: AttributePatch): Promise<RunRecord>;
  /** Cancels a workflow run if it has not already reached a terminal status. */
  cancel(runId: RunId): Promise<RunRecord>;
}

export interface ClientSchedulesApi {
  /** Schedules one workflow run at the next interval boundary. */
  next<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options: ScheduleNextOptions,
  ): Promise<WorkflowRunHandle<TOutput>>;
  /** Creates a recurring workflow schedule. */
  create<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    options: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord>;
  /** Creates or updates a recurring workflow schedule. */
  upsert<TInput, TOutput, TRawInput = TInput>(
    workflow: StartTarget<TInput, TOutput, TRawInput>,
    options: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord>;
  /** Returns a schedule by ID, if it exists. */
  get(scheduleId: ScheduleId): Promise<ScheduleRecord | undefined>;
  /** Lists schedules matching optional filters. */
  list(options?: ListSchedulesPageOptions): Promise<WorkflowPage<ScheduleRecord>>;
  /** Pauses an active schedule. */
  pause(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Resumes a paused or archived schedule. */
  resume(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Archives a schedule without deleting its record. */
  archive(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Marks a schedule as deleted. */
  delete(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Starts runs for schedules that are due. */
  tick(options?: TickSchedulesOptions): Promise<TickSchedulesResult>;
}

export interface ClientLocksApi {
  acquire(key: string, options: AcquireLockOptions): Promise<LockRecord>;
  /** Returns a workflow lock by key, if it exists. */
  get(key: string): Promise<LockRecord | undefined>;
  list(): Promise<readonly LockRecord[]>;
  /** Releases a workflow lock held by the supplied holder. */
  release(key: string, options: ReleaseLockOptions): Promise<LockRecord>;
  /** Releases a workflow lock only when its lease is stale. */
  releaseStale(key: string, options?: ReleaseStaleLockOptions): Promise<LockRecord>;
}

export interface ClientHooksApi {
  /** Completes a pending message-backed external resume hook. */
  resume(token: string, options?: ResumeHookOptions): Promise<void>;
  /** Disposes a pending message-backed external resume hook. */
  dispose(token: string): Promise<HookInspection>;
  /** Returns inspection data for an external resume hook token. */
  getByToken(token: string): Promise<HookInspection>;
}

export interface ClientStreamsApi {
  /** Returns metadata for a durable stream on a run. */
  getInfo(runId: RunId, streamIdOrName: StreamIdOrName): Promise<StreamInfo>;
  /** Follows durable stream updates from a run. */
  follow(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: FollowStreamOptions,
  ): AsyncIterable<StreamUpdate>;
  /** Waits until a durable stream exists on a run. */
  wait(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  /** Waits for the next durable stream chunk after an index. */
  waitForChunk(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    afterIndex: number,
    options?: WaitStreamOptions,
  ): Promise<StreamChunk | undefined>;
  /** Waits until a durable stream is closed or failed. */
  waitForTerminal(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  /** Reads all currently stored chunks for a durable stream. */
  read(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: ReadStreamOptions,
  ): Promise<StreamState>;
}

export interface ClientMessagesApi extends MessageSender {
  /** Broadcasts a named message to runs matching the target options. */
  broadcast(options: BroadcastMessageInput): Promise<BroadcastMessageResult>;
  /** Broadcasts a typed message channel payload to runs matching the target options. */
  broadcast<TPayload, TRawPayload = TPayload>(
    channel: MessageChannel<TPayload, TRawPayload>,
    options?: BroadcastMessageChannelOptions<TRawPayload>,
  ): Promise<BroadcastMessageResult>;
}

export interface ClientWorkersApi {
  /** Creates a worker bound to this client engine and registry. */
  create(options?: ClientWorkerOptions): WorkflowWorker;
  /** Processes a specific run once by ID. */
  processRun(runId: RunId, options?: ClientProcessRunOptions): Promise<void>;
  /** Processes currently due runs matching optional filters. */
  wakeDueRuns(options?: WakeDueRunsOptions): Promise<WorkerRunResult>;
}

/** Options for creating a worker from the grouped client worker API. */
export interface ClientWorkerOptions {
  readonly workerId?: WorkerId;
  readonly leaseDuration?: Temporal.Duration;
  readonly pollInterval?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly stopDrainTimeout?: Temporal.Duration;
  readonly missingImplementationRetry?: MissingImplementationRetryConfig;
}

/** Options for processing one run through a client worker facet. */
export interface ClientProcessRunOptions extends WorkerRunFilterOptions {
  readonly workerId?: string;
  readonly leaseDuration?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly missingImplementationRetry?: MissingImplementationRetryConfig;
  readonly signal?: AbortSignal;
}
