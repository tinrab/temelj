import type { Logger } from "@temelj/log";

import type { WorkflowHistory } from "../history/mod.ts";
import type {
  CleanupMarkerRecord,
  CleanupRunsOptions,
  CleanupRunsResult,
  RetentionPolicyOptions,
} from "./cleanup.ts";
import type { WorkflowImplementation, WorkflowStartTarget } from "./definition.ts";
import type {
  WorkflowDeterministicBytesContext,
  WorkflowDeterministicValueContext,
  WorkflowExecutionLimits,
  WorkflowRecordedIdContext,
} from "./engine-options.ts";
import type { EventRecord } from "./events.ts";
import type { HookInspection, ResumeHookOptions, ResumeWebhookOptions } from "./hook.ts";
import type {
  AcquireLockOptions,
  LockRecord,
  ReleaseLockOptions,
  ReleaseStaleLockOptions,
} from "./lock.ts";
import type {
  BroadcastMessageInput,
  BroadcastMessageResult,
  SendMessageChannelOptions,
  SendMessageInput,
  MessageChannel,
} from "./message.ts";
import type {
  ObservationEventHandler,
  ObservationEventPattern,
  ObservationUnsubscribe,
  ScheduleRunCreatedObservationEvent,
  WorkerOperationObservationEvent,
} from "./observation.ts";
import type { WorkflowPage, PageOptions } from "./pagination.ts";
import type { ExecutionResult, WorkflowHandle } from "./result.ts";
import type {
  WorkflowListRunsOptions,
  WorkflowListRunsPageOptions,
  WorkflowListStepAttemptsPageOptions,
} from "./run-list.ts";
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
} from "./run-options.ts";
import type { RunId, WorkflowAttributePatch, WorkflowRunRecord } from "./run.ts";
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
import type {
  WorkflowConditionalEventAppender,
  WorkflowEventReader,
  WorkflowMessageIdempotencyIndexLookup,
  WorkflowMessageIdempotencyIndex,
  WorkflowStorage,
  WorkflowStore,
  WorkflowStoreCapabilitiesSource,
  WorkflowRunLeaseRepository,
  WorkflowRunListerRepository,
  WorkflowRunReaderRepository,
  WorkflowRunWriterRepository,
  WorkflowStepAttemptLookup,
} from "./store.ts";
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
import type { Telemetry } from "./telemetry.ts";
import type { Timeline } from "./timeline.ts";

/** Store operations used while replaying and advancing one workflow run. */
export interface WorkflowExecutionEnvironmentStore
  extends
    WorkflowRunReaderRepository,
    WorkflowRunListerRepository,
    WorkflowRunWriterRepository,
    WorkflowMessageIdempotencyIndexLookup,
    WorkflowConditionalEventAppender,
    WorkflowEventReader {}

/** Store operations used by workflow workers. */
export interface WorkflowWorkerEngineStore
  extends
    WorkflowStoreCapabilitiesSource,
    WorkflowRunLeaseRepository,
    WorkflowRunReaderRepository,
    WorkflowRunWriterRepository,
    WorkflowConditionalEventAppender,
    WorkflowEventReader,
    WorkflowStepAttemptLookup {}

/** Internal execution context used while replaying and advancing one workflow run. */
export interface WorkflowExecutionEnvironment {
  /** Store used to read and persist run state during execution. */
  readonly store: WorkflowExecutionEnvironmentStore;
  /** Run ID currently being executed. */
  readonly runId: RunId;
  /** Replay history built from the run's durable events. */
  readonly history: WorkflowHistory;
  /** Clock used for timestamps recorded by this execution. */
  readonly now: () => Temporal.Instant;
  /** Deterministic ID factory used for recorded workflow commands. */
  readonly createRecordedId: (context: WorkflowRecordedIdContext) => string;
  /** Deterministic random-number factory used when first recording random commands. */
  readonly createDeterministicRandom: (context: WorkflowDeterministicValueContext) => number;
  /** Deterministic UUID factory used when first recording UUID commands. */
  readonly createDeterministicUuid: (context: WorkflowDeterministicValueContext) => string;
  /** Deterministic byte factory used when first recording byte commands. */
  readonly createDeterministicBytes: (context: WorkflowDeterministicBytesContext) => Uint8Array;
  /** Maximum number of materialized step attempts allowed for this run. */
  readonly maximumStepAttemptsPerRun: number;
  /** Runtime execution limits enforced by the engine. */
  readonly limits: WorkflowExecutionLimits;
  /** Current run record that owns this execution attempt. */
  readonly executionOwner: WorkflowRunRecord;
  /** Optional telemetry adapter used for workflow and step execution observations. */
  readonly telemetry?: Telemetry;
  /** Logger scoped to this execution. */
  readonly logger: Logger;
  /** Whether this execution is replaying previously-recorded durable events. */
  readonly replaying: boolean;
  /** Observer called after a durable event is appended. */
  readonly observeDurableEventAppended?: (
    runId: RunId,
    event: EventRecord,
    events: readonly EventRecord[],
  ) => void;
  /** Observer called after an external message is accepted for a run. */
  readonly observeMessageSent?: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "message_sent" }>,
  ) => void;
  /** Observer called after a child workflow start event is committed. */
  readonly observeChildWorkflowStarted?: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "child_workflow_started" }>,
  ) => void;
}

/** Engine capability for starting one workflow run. */
export interface WorkflowRunStarter {
  /** Creates one pending workflow run and returns a durable handle. */
  startWorkflow<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowHandle<TOutput>>;
}

/** Engine capability for starting workflow runs. */
export interface WorkflowStarter extends WorkflowRunStarter {
  /** Creates multiple pending workflow runs for the same definition. */
  startWorkflows<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    items: readonly WorkflowBatchStartItem<TRawInput>[],
  ): Promise<readonly WorkflowHandle<TOutput>[]>;
}

/** Engine capability for canceling workflow runs. */
export interface WorkflowRunCanceler {
  /** Cancels a workflow run if it has not already reached a terminal status. */
  cancelRun(runId: RunId): Promise<WorkflowRunRecord>;
}

/** Engine capability for maintaining one workflow run. */
export interface WorkflowRunMaintenance extends WorkflowRunCanceler {
  /** Moves a run back to pending at an optional new availability time. */
  rescheduleRun(runId: RunId, options?: WorkflowRescheduleRunOptions): Promise<WorkflowRunRecord>;
  /** Releases a run's worker lease when it is stale. */
  releaseStaleRunLease(
    runId: RunId,
    options?: WorkflowReleaseStaleLeaseOptions,
  ): Promise<WorkflowRunRecord>;
  /** Retries a failed workflow run. */
  retryFailedRun(runId: RunId, options?: WorkflowRetryFailedRunOptions): Promise<WorkflowRunRecord>;
  /** Marks a workflow run as permanently failed with an operator reason. */
  markRunPermanentlyFailed(
    runId: RunId,
    options: WorkflowMarkRunPermanentlyFailedOptions,
  ): Promise<WorkflowRunRecord>;
  /** Replaces a workflow run's metadata value. */
  updateRunMetadata(runId: RunId, metadata: unknown): Promise<WorkflowRunRecord>;
  /** Applies an attribute patch to a workflow run. */
  setRunAttributes(runId: RunId, attributes: WorkflowAttributePatch): Promise<WorkflowRunRecord>;
}

/** Engine capability for managing recurring workflow schedules. */
export interface WorkflowScheduler {
  /** Creates one pending run at the next interval boundary. */
  scheduleNextWorkflow<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options: ScheduleNextOptions,
  ): Promise<WorkflowHandle<TOutput>>;
  /** Creates a recurring workflow schedule. */
  createSchedule<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    options: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord<TInput>>;
  /** Creates or updates a recurring workflow schedule. */
  upsertSchedule<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    options: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord<TInput>>;
  /** Returns a schedule by ID, if it exists. */
  getSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord | undefined>;
  /** Lists schedules matching optional filters. */
  listSchedules(options?: ListSchedulesOptions): Promise<readonly ScheduleRecord[]>;
  /** Lists one page of schedules matching optional filters. */
  listSchedulesPage(options?: ListSchedulesPageOptions): Promise<WorkflowPage<ScheduleRecord>>;
  /** Pauses an active schedule. */
  pauseSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Resumes a paused or archived schedule. */
  resumeSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Archives a schedule without deleting its record. */
  archiveSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Marks a schedule as deleted. */
  deleteSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Starts runs for schedules that are due. */
  tickSchedules(options?: TickSchedulesOptions): Promise<TickSchedulesResult>;
}

/** Engine capability for observing worker-side operations. */
export interface WorkflowWorkerOperationObserver {
  /** Observes worker-side operations that do not always produce durable run transitions. */
  observeWorkerOperation(event: WorkerOperationObservationEvent): void;
}

/** Engine capability for observing schedule-created runs. */
export interface WorkflowScheduleRunObserver {
  /** Observes recurring schedule ticks that create workflow runs. */
  observeScheduleRunCreated(event: ScheduleRunCreatedObservationEvent): void;
}

/** Engine capability for managing workflow locks. */
export interface LockManager {
  /** Acquires a workflow lock for a holder. */
  acquireLock(key: string, options: AcquireLockOptions): Promise<LockRecord>;
  /** Returns a workflow lock by key, if it exists. */
  getLock(key: string): Promise<LockRecord | undefined>;
  /** Lists workflow locks. */
  listLocks(): Promise<readonly LockRecord[]>;
  /** Releases a workflow lock held by the supplied holder. */
  releaseLock(key: string, options: ReleaseLockOptions): Promise<LockRecord>;
  /** Releases a workflow lock only when its lease is stale. */
  releaseStaleLock(key: string, options?: ReleaseStaleLockOptions): Promise<LockRecord>;
}

/** Engine capability for resuming workflow execution. */
export interface WorkflowExecutor {
  /** Resumes an existing run with a registered workflow implementation. */
  resumeWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    runId: RunId,
    options?: WorkflowResumeOptions,
  ): Promise<ExecutionResult<TOutput>>;
}

/** Engine capability for reading one workflow run handle. */
export interface WorkflowRunHandleReader {
  /** Returns a workflow run by ID, if it exists. */
  getRun(runId: RunId): Promise<WorkflowRunRecord | undefined>;
  /** Returns all durable events recorded for a run. */
  getEvents(runId: RunId): Promise<readonly EventRecord[]>;
  /** Returns a timeline projection for one run. */
  getTimeline(runId: RunId): Promise<Timeline>;
}

/** Engine capability for reading workflow runs and event history. */
export interface WorkflowRunReader extends WorkflowRunHandleReader {
  /** Lists one page of durable events recorded for a run. */
  listEventsPage(runId: RunId, options?: PageOptions): Promise<WorkflowPage<EventRecord>>;
  /** Lists workflow runs matching optional filters. */
  listRuns(options?: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]>;
  /** Lists one page of workflow runs matching optional filters. */
  listRunsPage(options?: WorkflowListRunsPageOptions): Promise<WorkflowPage<WorkflowRunRecord>>;
  /** Counts workflow runs matching optional filters. */
  countRuns(options?: WorkflowListRunsOptions): Promise<number>;
  /** Returns aggregate run metrics for runs matching optional filters. */
  getRunSummary(options?: WorkflowRunSummaryOptions): Promise<WorkflowRunSummary>;
  /** Returns recovery-oriented aggregate metrics for runs matching optional filters. */
  getRecoverySummary(options?: WorkflowRecoverySummaryOptions): Promise<WorkflowRecoverySummary>;
}

/** Engine capability for listing materialized step attempt state. */
export interface WorkflowStepAttemptLookupReader {
  /** Lists materialized step attempts for a run. */
  listStepAttempts(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<readonly WorkflowStepAttemptRecord[]>;
}

/** Engine capability for reading materialized step attempt state. */
export interface WorkflowStepAttemptReader extends WorkflowStepAttemptLookupReader {
  /** Lists one page of materialized step attempts for a run. */
  listStepAttemptsPage(
    runId: RunId,
    options?: WorkflowListStepAttemptsPageOptions,
  ): Promise<WorkflowPage<WorkflowStepAttemptRecord>>;
  /** Counts materialized step attempts for a run. */
  countStepAttempts(runId: RunId, options?: WorkflowListStepAttemptsOptions): Promise<number>;
  /** Returns aggregate step-attempt metrics for a run. */
  getStepAttemptSummary(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<WorkflowStepAttemptSummary>;
}

/** Engine capability for maintaining materialized step attempt state. */
export interface WorkflowStepAttemptMaintenance {
  /** Rebuilds materialized step attempts for a run from its event history. */
  repairStepAttempts(runId: RunId): Promise<readonly WorkflowStepAttemptRecord[]>;
}

/** Engine capability for maintaining message idempotency indexes. */
export interface WorkflowMessageIdempotencyMaintenance {
  /** Rebuilds message idempotency indexes for a run from its event history. */
  repairMessageIdempotencyIndexes(
    runId: RunId,
  ): Promise<readonly WorkflowMessageIdempotencyIndex[]>;
}

/** Engine capability for cleaning up terminal workflow data. */
export interface WorkflowCleanupAdmin {
  /** Deletes terminal run data according to cleanup options. */
  cleanupRuns(options: CleanupRunsOptions): Promise<CleanupRunsResult>;
  /** Lists cleanup marker records. */
  listCleanupMarkers(): Promise<readonly CleanupMarkerRecord[]>;
  /** Deletes terminal run data according to a retention policy. */
  applyRetentionPolicy(options: RetentionPolicyOptions): Promise<CleanupRunsResult>;
}

/** Engine capability for creating new runs from existing run records. */
export interface WorkflowRunRerunner {
  /** Creates a new run from an existing run record and returns its handle. */
  rerunWorkflow(runId: RunId, options?: WorkflowRerunOptions): Promise<WorkflowHandle<unknown>>;
}

/** Engine capability for administrative workflow maintenance. */
export interface WorkflowAdmin extends WorkflowCleanupAdmin, WorkflowRunRerunner {}

/** Engine capability for managing external resume hooks. */
export interface WorkflowHookManager {
  /** Completes a pending message-backed external resume hook. */
  resumeHook(token: string, options?: ResumeHookOptions): Promise<void>;
  /** Completes a pending webhook-labeled external resume hook. */
  resumeWebhook(token: string, options?: ResumeWebhookOptions): Promise<void>;
  /** Disposes a pending message-backed external resume hook. */
  disposeHook(token: string): Promise<HookInspection>;
  /** Disposes a pending webhook-labeled external resume hook. */
  disposeWebhook(token: string): Promise<HookInspection>;
  /** Returns inspection data for an external resume hook token. */
  getHookByToken(token: string): Promise<HookInspection>;
}

/** Engine capability for reading and following durable streams. */
export interface WorkflowStreamReader {
  /** Returns metadata for a durable stream on a run. */
  getStreamInfo(runId: RunId, streamIdOrName: StreamIdOrName): Promise<StreamInfo>;
  /** Follows durable stream updates from a run. */
  followStream<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: FollowStreamOptions,
  ): AsyncIterable<StreamUpdate<TChunk>>;
  /** Waits until a durable stream exists on a run. */
  waitForStream(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  /** Waits for the next durable stream chunk after an index. */
  waitForStreamChunk<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    afterIndex: number,
    options?: WaitStreamOptions,
  ): Promise<StreamChunk<TChunk> | undefined>;
  /** Waits until a durable stream is closed or failed. */
  waitForStreamTerminal(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: WaitStreamOptions,
  ): Promise<StreamInfo | undefined>;
  /** Reads all currently stored chunks for a durable stream. */
  readStream<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: ReadStreamOptions,
  ): Promise<StreamState<TChunk>>;
  /** Reads one page of currently stored chunks for a durable stream. */
  readStreamPage<TChunk = unknown>(
    runId: RunId,
    streamIdOrName: StreamIdOrName,
    options?: ReadStreamPageOptions,
  ): Promise<StreamPage<TChunk>>;
}

/** Engine capability for sending workflow messages. */
export interface WorkflowMessageSender {
  /** Sends a named message to a workflow run. */
  sendMessage(runId: RunId, options: SendMessageInput): Promise<void>;
  /** Sends a typed message channel payload to a workflow run. */
  sendMessage<TPayload, TKey = void>(
    runId: RunId,
    channel: MessageChannel<TPayload, TKey>,
    options?: SendMessageChannelOptions<TPayload, TKey>,
  ): Promise<void>;
  /** Sends a named message to runs matching the broadcast target. */
  broadcastMessage(options: BroadcastMessageInput): Promise<BroadcastMessageResult>;
  /** Sends a typed message channel payload to runs matching the broadcast target. */
  broadcastMessage<TPayload, TKey = void>(
    channel: MessageChannel<TPayload, TKey>,
    options?: SendMessageChannelOptions<TPayload, TKey>,
  ): Promise<BroadcastMessageResult>;
}

/** Engine surface required by the workflow client facade. */
export interface WorkflowClientEngine
  extends
    WorkflowStarter,
    WorkflowRunCanceler,
    WorkflowRunMaintenance,
    WorkflowScheduler,
    LockManager,
    WorkflowRunReader,
    WorkflowStepAttemptReader,
    WorkflowAdmin,
    WorkflowHookManager,
    WorkflowStreamReader,
    WorkflowMessageSender {
  /** Flushes owned logger resources and shuts down owned telemetry, when supported. */
  close?(): Promise<void>;
}

/** Engine surface required by workflow workers. */
export interface WorkflowWorkerEngine extends WorkflowExecutor {
  /** Store used by workers to claim, heartbeat, and release runs. */
  readonly store: WorkflowWorkerEngineStore;

  /** Returns a workflow run by ID, if it exists. */
  getRun(runId: RunId): Promise<WorkflowRunRecord | undefined>;
  /** Returns aggregate run metrics for runs matching optional filters. */
  getRunSummary(options?: WorkflowRunSummaryOptions): Promise<WorkflowRunSummary>;
  /** Lists schedules matching optional filters. */
  listSchedules(options?: ListSchedulesOptions): Promise<readonly ScheduleRecord[]>;
  /** Starts runs for schedules that are due. */
  tickSchedules(options?: TickSchedulesOptions): Promise<TickSchedulesResult>;
  /** Observes worker-side operations that do not always produce durable run transitions. */
  observeWorkerOperation?(event: WorkerOperationObservationEvent): void;
}

/** Combined workflow engine surface used by runtime and adapter APIs. */
export interface WorkflowEngineLike
  extends
    WorkflowStarter,
    WorkflowScheduler,
    LockManager,
    WorkflowExecutor,
    WorkflowRunReader,
    WorkflowStepAttemptReader,
    WorkflowStepAttemptMaintenance,
    WorkflowMessageIdempotencyMaintenance,
    WorkflowWorkerOperationObserver,
    WorkflowScheduleRunObserver,
    WorkflowRunCanceler,
    WorkflowRunMaintenance,
    WorkflowAdmin,
    WorkflowHookManager,
    WorkflowStreamReader,
    WorkflowMessageSender {}

/** Describes the workflow engine contract. */
export interface WorkflowEngine extends WorkflowEngineLike {
  /** Underlying key-value storage used by the default workflow store. */
  readonly storage: WorkflowStorage;
  /** Store used for durable workflow state, events, schedules, locks, and indexes. */
  readonly store: WorkflowStore;
  /** Subscribes to workflow observation events matching a pattern. */
  on<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): ObservationUnsubscribe;
  /** Subscribes to the next workflow observation event matching a pattern. */
  once<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): ObservationUnsubscribe;
  /** Removes a workflow observation event handler for a pattern. */
  off<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
    handler: ObservationEventHandler<Pattern>,
  ): void;
  /** Returns all registered observation event handlers. */
  listeners(): readonly ObservationEventHandler[];
  /** Returns observation event handlers registered for a pattern. */
  listeners<Pattern extends ObservationEventPattern>(
    pattern: Pattern,
  ): readonly ObservationEventHandler<Pattern>[];
  /** Removes observation event handlers, optionally limited to a pattern. */
  clearListeners(pattern?: ObservationEventPattern): void;
  /** Returns the number of observation event handlers, optionally limited to a pattern. */
  listenerCount(pattern?: ObservationEventPattern): number;
  /** Flushes the engine logger and shuts down the telemetry adapter configured on this engine. */
  close(): Promise<void>;
  /** Starts and immediately attempts to execute a workflow implementation. */
  runWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowExecutionOptions,
  ): Promise<WorkflowHandle<TOutput>>;
  /** Executes a workflow implementation synchronously against a newly started run. */
  runWorkflowNow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowExecutionOptions,
  ): Promise<ExecutionResult<TOutput>>;
}
