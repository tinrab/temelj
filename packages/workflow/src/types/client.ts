import type {
  CleanupMarkerRecord,
  CleanupRunsOptions,
  CleanupRunsResult,
  RetentionPolicyOptions,
} from "./cleanup.ts";
import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  WorkflowStartTarget,
} from "./definition.ts";
import type { EventRecord } from "./events.ts";
import type { HookInspection, ResumeHookOptions, ResumeWebhookOptions } from "./hook.ts";
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
  SendMessageChannelOptions,
  SendMessageInput,
  MessageChannel,
} from "./message.ts";
import type { WorkflowPage, PageOptions } from "./pagination.ts";
import type { ResultOptions } from "./result.ts";
import type { WorkflowMissingImplementationRetryConfig } from "./retry.ts";
import type {
  WorkflowListRunsOptions,
  WorkflowListRunsPageOptions,
  WorkflowListStepAttemptsPageOptions,
} from "./run-list.ts";
import type {
  WorkflowBatchStartItem,
  WorkflowMarkRunPermanentlyFailedOptions,
  WorkflowReleaseStaleLeaseOptions,
  WorkflowRerunOptions,
  WorkflowRescheduleRunOptions,
  WorkflowRetryFailedRunOptions,
  WorkflowRunArguments,
  WorkflowStartOptions,
  ScheduleNextOptions,
} from "./run-options.ts";
import type { RunId, WorkflowAttributePatch, WorkflowRunRecord, WorkflowRunStatus } from "./run.ts";
import type {
  ScheduleId,
  ListSchedulesOptions,
  ListSchedulesPageOptions,
  ScheduleConfig,
  ScheduleRecord,
  TickSchedulesOptions,
  TickSchedulesResult,
} from "./schedule.ts";
import type {
  WorkflowListStepAttemptsOptions,
  WorkflowStepAttemptRecord,
  WorkflowStepAttemptSummary,
} from "./step-attempts.ts";
import type { StreamIdOrName } from "./stream-id.ts";
import type {
  FollowStreamOptions,
  ReadStreamPageOptions,
  ReadStreamOptions,
  StreamChunk,
  StreamInfo,
  StreamPage,
  StreamState,
  StreamUpdate,
  WaitStreamOptions,
} from "./stream.ts";
import type {
  WorkflowRecoverySummary,
  WorkflowRecoverySummaryOptions,
  WorkflowRunSummary,
  WorkflowRunSummaryOptions,
} from "./summary.ts";
import type { Timeline } from "./timeline.ts";
import type { WorkerId } from "./worker-id.ts";
import type {
  WorkflowWakeDueRunsOptions,
  WorkflowWorker,
  WorkflowWorkerRunFilterOptions,
  WorkflowWorkerRunResult,
} from "./worker.ts";

/** Function shape emitted by the directive compiler for workflow and step functions. */
export type CompiledWorkflowFunction<TArgs extends readonly unknown[], TOutput> = (
  ...args: TArgs
) => Promise<TOutput> | TOutput;

/** Client-level handle for awaiting output and inspecting a workflow run. */
export interface WorkflowRunHandle<TOutput = unknown> {
  /** ID of the workflow run represented by this handle. */
  readonly runId: RunId;
  /** Workflow definition name stored on the run. */
  readonly workflowName: string;
  /** Workflow version stored on the run, when one was resolved. */
  readonly workflowVersion?: string;
  /** Returns the latest run record. */
  getRun(): Promise<WorkflowRunRecord>;
  /** Returns the latest run status. */
  status(): Promise<WorkflowRunStatus>;
  /** Returns all durable events recorded for the run. */
  events(): Promise<readonly EventRecord[]>;
  /** Returns a timeline projection of the run's event history. */
  timeline(): Promise<Timeline>;
  /** Waits for and returns the completed workflow output. */
  result(options?: ResultOptions): Promise<TOutput>;
  /** Returns metadata for a durable stream on this run. */
  getStreamInfo(streamIdOrName: StreamIdOrName): Promise<StreamInfo>;
  /** Follows durable stream updates from this run. */
  followStream<TChunk = unknown>(
    streamIdOrName: StreamIdOrName,
    options?: FollowStreamOptions,
  ): AsyncIterable<StreamUpdate<TChunk>>;
  /** Waits until a durable stream exists on this run. */
  waitForStream(
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  /** Waits for the next durable stream chunk after an index. */
  waitForStreamChunk<TChunk = unknown>(
    streamIdOrName: StreamIdOrName,
    afterIndex: number,
    options?: WaitStreamOptions,
  ): Promise<StreamChunk<TChunk> | undefined>;
  /** Waits until a durable stream is closed or failed. */
  waitForStreamTerminal(
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  /** Reads all currently stored chunks for a durable stream. */
  readStream<TChunk = unknown>(
    streamIdOrName: StreamIdOrName,
    options?: ReadStreamOptions,
  ): Promise<StreamState<TChunk>>;
  /** Reads one page of currently stored chunks for a durable stream. */
  readStreamPage<TChunk = unknown>(
    streamIdOrName: StreamIdOrName,
    options?: ReadStreamPageOptions,
  ): Promise<StreamPage<TChunk>>;
  /** Moves the run back to pending at an optional new availability time. */
  reschedule(options?: WorkflowRescheduleRunOptions): Promise<WorkflowRunRecord>;
  /** Releases this run's worker lease when it is stale. */
  releaseStaleLease(options?: WorkflowReleaseStaleLeaseOptions): Promise<WorkflowRunRecord>;
  /** Retries this failed run. */
  retryFailed(options?: WorkflowRetryFailedRunOptions): Promise<WorkflowRunRecord>;
  /** Marks this run as permanently failed with an operator reason. */
  markPermanentlyFailed(
    options: WorkflowMarkRunPermanentlyFailedOptions,
  ): Promise<WorkflowRunRecord>;
  /** Replaces this run's metadata value. */
  setMetadata(metadata: unknown): Promise<WorkflowRunRecord>;
  /** Applies an attribute patch to this run. */
  setAttributes(attributes: WorkflowAttributePatch): Promise<WorkflowRunRecord>;
  /** Cancels this run if it has not already reached a terminal status. */
  cancel(): Promise<WorkflowRunRecord>;
}

/** Runnable wrapper that starts a workflow definition through a bound client. */
export interface WorkflowRunnable<TInput = unknown, TOutput = unknown, TRawInput = TInput> {
  /** Workflow definition that will be started by run. */
  readonly definition: WorkflowDefinition<TInput, TOutput, TRawInput>;
  /** Starts the workflow through the bound client and returns a run handle. */
  run(
    ...args: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
}

/** Describes the workflow client contract. */
export interface WorkflowClient {
  /** Grouped run inspection and history operations. */
  readonly runs: WorkflowClientRunsApi;
  /** Grouped administrative run maintenance operations. */
  readonly admin: WorkflowClientAdminApi;
  /** Grouped schedule management operations. */
  readonly schedules: WorkflowClientSchedulesApi;
  /** Grouped workflow lock operations. */
  readonly locks: WorkflowClientLocksApi;
  /** Grouped external resume hook operations. */
  readonly hooks: WorkflowClientHooksApi;
  /** Grouped durable stream read operations. */
  readonly streams: WorkflowClientStreamsApi;
  /** Grouped message send operations. */
  readonly messages: WorkflowClientMessagesApi;
  /** Grouped worker creation and wake operations. */
  readonly workers: WorkflowClientWorkersApi;
  /** Flushes resources owned by the underlying engine when it supports explicit shutdown. */
  close(): Promise<void>;
  /** Registers a workflow implementation in the client's registry. */
  implementWorkflow<TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput>;
  /** Registers an existing workflow implementation in the client's registry. */
  register<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void;
  /** Registers a workflow implementation and returns a client-bound runnable. */
  workflow<TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowRunnable<TInput, TOutput, TRawInput>;
}

/** Describes the workflow client runs API contract. */
export interface WorkflowClientRunsApi {
  /** Starts one workflow run and returns a typed handle. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    ...args: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  /** Starts multiple workflow runs for the same definition. */
  startBatch<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    items: readonly WorkflowBatchStartItem<TRawInput>[],
  ): Promise<readonly WorkflowRunHandle<TOutput>[]>;
  /** Returns a workflow run by ID, if it exists. */
  get(runId: RunId): Promise<WorkflowRunRecord | undefined>;
  /** Returns all durable events recorded for a run. */
  events(runId: RunId): Promise<readonly EventRecord[]>;
  /** Lists one page of durable events recorded for a run. */
  eventsPage(runId: RunId, options?: PageOptions): Promise<WorkflowPage<EventRecord>>;
  /** Lists workflow runs matching optional filters. */
  list(options?: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]>;
  /** Lists one page of workflow runs matching optional filters. */
  page(options?: WorkflowListRunsPageOptions): Promise<WorkflowPage<WorkflowRunRecord>>;
  /** Counts workflow runs matching optional filters. */
  count(options?: WorkflowListRunsOptions): Promise<number>;
  /** Returns aggregate run metrics for runs matching optional filters. */
  summary(options?: WorkflowRunSummaryOptions): Promise<WorkflowRunSummary>;
  /** Returns recovery-oriented aggregate metrics for runs matching optional filters. */
  recovery(options?: WorkflowRecoverySummaryOptions): Promise<WorkflowRecoverySummary>;
  /** Returns a timeline projection for one run. */
  timeline(runId: RunId): Promise<Timeline>;
  /** Lists materialized step attempts for a run. */
  listStepAttempts(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<readonly WorkflowStepAttemptRecord[]>;
  /** Lists one page of materialized step attempts for a run. */
  listStepAttemptsPage(
    runId: RunId,
    options?: WorkflowListStepAttemptsPageOptions,
  ): Promise<WorkflowPage<WorkflowStepAttemptRecord>>;
  /** Counts materialized step attempts for a run. */
  countStepAttempts(runId: RunId, options?: WorkflowListStepAttemptsOptions): Promise<number>;
  /** Returns aggregate step-attempt metrics for a run. */
  stepAttemptSummary(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<WorkflowStepAttemptSummary>;
}

/** Describes the workflow client admin API contract. */
export interface WorkflowClientAdminApi {
  /** Deletes terminal run data according to cleanup options. */
  cleanup(options: CleanupRunsOptions): Promise<CleanupRunsResult>;
  /** Lists cleanup marker records. */
  cleanupMarkers(): Promise<readonly CleanupMarkerRecord[]>;
  /** Deletes terminal run data according to a retention policy. */
  applyRetentionPolicy(options: RetentionPolicyOptions): Promise<CleanupRunsResult>;
  /** Creates a new run from an existing run record and returns its handle. */
  rerun(runId: RunId, options?: WorkflowRerunOptions): Promise<WorkflowRunHandle<unknown>>;
  /** Moves a run back to pending at an optional new availability time. */
  reschedule(runId: RunId, options?: WorkflowRescheduleRunOptions): Promise<WorkflowRunRecord>;
  /** Releases a run's worker lease when it is stale. */
  releaseStaleLease(
    runId: RunId,
    options?: WorkflowReleaseStaleLeaseOptions,
  ): Promise<WorkflowRunRecord>;
  /** Retries a failed workflow run. */
  retryFailed(runId: RunId, options?: WorkflowRetryFailedRunOptions): Promise<WorkflowRunRecord>;
  /** Marks a workflow run as permanently failed with an operator reason. */
  markPermanentlyFailed(
    runId: RunId,
    options: WorkflowMarkRunPermanentlyFailedOptions,
  ): Promise<WorkflowRunRecord>;
  /** Replaces a workflow run's metadata value. */
  updateMetadata(runId: RunId, metadata: unknown): Promise<WorkflowRunRecord>;
  /** Applies an attribute patch to a workflow run. */
  setAttributes(runId: RunId, attributes: WorkflowAttributePatch): Promise<WorkflowRunRecord>;
  /** Cancels a workflow run if it has not already reached a terminal status. */
  cancel(runId: RunId): Promise<WorkflowRunRecord>;
}

/** Describes the workflow client schedules API contract. */
export interface WorkflowClientSchedulesApi {
  /** Schedules one workflow run at the next interval boundary. */
  next<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options: ScheduleNextOptions,
  ): Promise<WorkflowRunHandle<TOutput>>;
  /** Creates a recurring workflow schedule. */
  create<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    options: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord<TInput>>;
  /** Creates or updates a recurring workflow schedule. */
  upsert<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    options: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord<TInput>>;
  /** Returns a schedule by ID, if it exists. */
  get(scheduleId: ScheduleId): Promise<ScheduleRecord | undefined>;
  /** Lists schedules matching optional filters. */
  list(options?: ListSchedulesOptions): Promise<readonly ScheduleRecord[]>;
  /** Lists one page of schedules matching optional filters. */
  page(options?: ListSchedulesPageOptions): Promise<WorkflowPage<ScheduleRecord>>;
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

/** Describes the workflow client locks API contract. */
export interface WorkflowClientLocksApi {
  /** Acquires a workflow lock. */
  acquire(key: string, options: AcquireLockOptions): Promise<LockRecord>;
  /** Returns a workflow lock by key, if it exists. */
  get(key: string): Promise<LockRecord | undefined>;
  /** Lists workflow locks. */
  list(): Promise<readonly LockRecord[]>;
  /** Releases a workflow lock held by the supplied holder. */
  release(key: string, options: ReleaseLockOptions): Promise<LockRecord>;
  /** Releases a workflow lock only when its lease is stale. */
  releaseStale(key: string, options?: ReleaseStaleLockOptions): Promise<LockRecord>;
}

/** Describes the workflow client external hook API contract. */
export interface WorkflowClientHooksApi {
  /** Completes a pending message-backed external resume hook. */
  resume(token: string, options?: ResumeHookOptions): Promise<void>;
  /** Completes a pending webhook-labeled external resume hook. */
  resumeWebhook(token: string, options?: ResumeWebhookOptions): Promise<void>;
  /** Disposes a pending message-backed external resume hook. */
  dispose(token: string): Promise<HookInspection>;
  /** Disposes a pending webhook-labeled external resume hook. */
  disposeWebhook(token: string): Promise<HookInspection>;
  /** Returns inspection data for an external resume hook token. */
  getByToken(token: string): Promise<HookInspection>;
}

/** Describes the workflow client streams API contract. */
export interface WorkflowClientStreamsApi {
  /** Returns metadata for a durable stream on a run. */
  getInfo(runId: RunId, streamIdOrName: StreamIdOrName): Promise<StreamInfo>;
  /** Follows durable stream updates from a run. */
  follow<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: FollowStreamOptions,
  ): AsyncIterable<StreamUpdate<TChunk>>;
  /** Waits until a durable stream exists on a run. */
  wait(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  /** Waits for the next durable stream chunk after an index. */
  waitForChunk<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    afterIndex: number,
    options?: WaitStreamOptions,
  ): Promise<StreamChunk<TChunk> | undefined>;
  /** Waits until a durable stream is closed or failed. */
  waitForTerminal(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  /** Reads all currently stored chunks for a durable stream. */
  read<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: ReadStreamOptions,
  ): Promise<StreamState<TChunk>>;
  /** Reads one page of currently stored chunks for a durable stream. */
  readPage<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: ReadStreamPageOptions,
  ): Promise<StreamPage<TChunk>>;
}

/** Describes the workflow client messages API contract. */
export interface WorkflowClientMessagesApi {
  /** Sends a named message to a workflow run. */
  send(runId: RunId, options: SendMessageInput): Promise<void>;
  /** Sends a typed message channel payload to a workflow run. */
  send<TPayload, TKey = void>(
    runId: RunId,
    channel: MessageChannel<TPayload, TKey>,
    options?: SendMessageChannelOptions<TPayload, TKey>,
  ): Promise<void>;
  /** Broadcasts a named message to runs matching the target options. */
  broadcast(options: BroadcastMessageInput): Promise<BroadcastMessageResult>;
  /** Broadcasts a typed message channel payload to runs matching the target options. */
  broadcast<TPayload, TKey = void>(
    channel: MessageChannel<TPayload, TKey>,
    options?: BroadcastMessageChannelOptions<TPayload, TKey>,
  ): Promise<BroadcastMessageResult>;
}

/** Describes the workflow client worker API contract. */
export interface WorkflowClientWorkersApi {
  /** Creates a worker bound to this client engine and registry. */
  create(options?: WorkflowClientWorkerOptions): WorkflowWorker;
  /** Processes a specific run once by ID. */
  processRun(runId: RunId, options?: WorkflowClientProcessRunOptions): Promise<void>;
  /** Processes currently due runs matching optional filters. */
  wakeDueRuns(options?: WorkflowWakeDueRunsOptions): Promise<WorkflowWorkerRunResult>;
}

/** Options for creating a worker from the grouped client worker API. */
export interface WorkflowClientWorkerOptions {
  readonly workerId?: WorkerId;
  readonly leaseDuration?: Temporal.Duration;
  readonly pollInterval?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly stopDrainTimeout?: Temporal.Duration;
  readonly missingImplementationRetry?: WorkflowMissingImplementationRetryConfig;
}

/** Options for processing one run through a client worker facet. */
export interface WorkflowClientProcessRunOptions extends WorkflowWorkerRunFilterOptions {
  readonly workerId?: string;
  readonly leaseDuration?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly missingImplementationRetry?: WorkflowMissingImplementationRetryConfig;
  readonly signal?: AbortSignal;
}
