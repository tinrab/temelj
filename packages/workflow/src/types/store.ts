import type { Storage, StorageValue } from "@temelj/storage";

import type { CleanupMarkerRecord, CleanupRunsOptions, CleanupRunsResult } from "./cleanup.ts";
import type { EventRecord } from "./events.ts";
import type { LockRecord } from "./lock.ts";
import type { MessageId } from "./message-id.ts";
import type { WorkflowPage, PageOptions } from "./pagination.ts";
import type { WorkflowListRunsOptions } from "./run-list.ts";
import type { RunId } from "./run.ts";
import type { WorkflowRunRecord } from "./run.ts";
import type { ScheduleId, ListSchedulesOptions, ScheduleRecord } from "./schedule.ts";
import type {
  WorkflowListStepAttemptsOptions,
  WorkflowStepAttemptRecord,
} from "./step-attempts.ts";
import type { WorkflowWorkerRunFilterOptions } from "./worker.ts";

/** Type used for workflow storage values. */
export type WorkflowStorage = Storage<Record<string, StorageValue>, StorageValue>;

/** Storage value stored for cleanup index entries. */
export type WorkflowCleanupIndexValue = StorageValue;

/** Storage index entry removed during workflow cleanup. */
export interface WorkflowCleanupIndexKey {
  readonly key: string;
  readonly value: WorkflowCleanupIndexValue;
}

/** Index entry used to detect duplicate messageId delivery idempotency keys. */
export interface WorkflowMessageIdempotencyIndex {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly timestamp: Temporal.Instant;
}

/** Options for workflow creation store. */
export interface CreateWorkflowStoreOptions {
  readonly storage?: WorkflowStorage;
  readonly namespace?: string;
}

/** Exposes workflow store namespace identity. */
export interface WorkflowStoreNamespace {
  /** Namespace prefix used to isolate workflow records in storage. */
  readonly namespace: string;
}

/** Exposes workflow store storage identity. */
export interface WorkflowStoreStorageContext extends WorkflowStoreNamespace {
  /** Underlying key-value storage used by the workflow store. */
  readonly storage: WorkflowStorage;
}

/** Shared workflow store metadata needed by default repository implementations. */
export interface WorkflowStoreMetadata
  extends WorkflowStoreStorageContext, WorkflowStoreCapabilitiesSource {}

/** Exposes workflow store capability flags. */
export interface WorkflowStoreCapabilitiesSource {
  /** Store capability flags used by engine services to choose safe coordination code paths. */
  readonly capabilities: WorkflowStoreCapabilities;
}

/** Creates workflow run records. */
export interface WorkflowRunCreationRepository {
  /** Creates a workflow run record. */
  createRun(run: WorkflowRunRecord): Promise<WorkflowRunRecord>;
}

/** Reads workflow run records. */
export interface WorkflowRunReaderRepository {
  /** Returns a workflow run by ID, if it exists. */
  getRun(runId: RunId): Promise<WorkflowRunRecord | undefined>;
}

/** Updates workflow run records conditionally. */
export interface WorkflowRunConditionalWriterRepository {
  /** Replaces a workflow run only when the stored record still matches the current value. */
  updateRunIfCurrent(
    current: WorkflowRunRecord,
    next: WorkflowRunRecord,
  ): Promise<WorkflowRunRecord | undefined>;
}

/** Updates workflow run records unconditionally. */
export interface WorkflowRunUnconditionalWriterRepository {
  /** Replaces a workflow run record. */
  updateRun(run: WorkflowRunRecord): Promise<WorkflowRunRecord>;
}

/** Updates workflow run records. */
export interface WorkflowRunWriterRepository
  extends WorkflowRunUnconditionalWriterRepository, WorkflowRunConditionalWriterRepository {}

/** Lists workflow run records. */
export interface WorkflowRunListerRepository {
  /** Lists workflow runs matching optional filters. */
  listRuns(options?: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]>;
}

/** Queries workflow run records. */
export interface WorkflowRunQueryRepository
  extends WorkflowRunReaderRepository, WorkflowRunListerRepository {
  /** Lists one page of workflow runs matching optional filters. */
  listRunsPage(
    options?: WorkflowListRunsOptions & PageOptions,
  ): Promise<WorkflowPage<WorkflowRunRecord>>;
  /** Counts workflow runs matching optional filters. */
  countRuns(options?: WorkflowListRunsOptions): Promise<number>;
}

/** Coordinates workflow run worker leases. */
export interface WorkflowRunLeaseRepository {
  /** Claims a pending or reclaimable run for a worker. */
  claimRun(options: WorkflowClaimRunOptions): Promise<WorkflowRunRecord | undefined>;
  /** Extends the lease for a run already claimed by a worker. */
  extendRunLease(options: WorkflowExtendRunLeaseOptions): Promise<WorkflowRunRecord | undefined>;
  /** Releases the lease for a run claimed by a worker. */
  releaseRunLease(options: WorkflowReleaseRunLeaseOptions): Promise<WorkflowRunRecord | undefined>;
}

/** Stores workflow run records and run leases. */
export interface WorkflowRunRepository
  extends
    WorkflowRunCreationRepository,
    WorkflowRunReaderRepository,
    WorkflowRunUnconditionalWriterRepository,
    WorkflowRunConditionalWriterRepository,
    WorkflowRunWriterRepository,
    WorkflowRunListerRepository,
    WorkflowRunQueryRepository,
    WorkflowRunLeaseRepository {}

/** Stores workflow-scoped idempotency indexes for run creation. */
export interface WorkflowIdempotencyIndex {
  /** Returns a workflow run by its workflow-scoped idempotency key, if it exists. */
  getRunByIdempotencyKey(
    options: WorkflowIdempotencyKeyOptions,
  ): Promise<WorkflowRunRecord | undefined>;
}

/** Repairs duplicate-delivery idempotency indexes for messages sent to workflow runs. */
export interface WorkflowMessageIdempotencyRepairModel {
  /** Rebuilds message idempotency indexes for a run from its event history. */
  repairMessageIdempotencyIndexes(
    runId: RunId,
  ): Promise<readonly WorkflowMessageIdempotencyIndex[]>;
}

/** Looks up duplicate-delivery idempotency indexes for messages sent to workflow runs. */
export interface WorkflowMessageIdempotencyIndexLookup {
  /** Returns true when a message idempotency key is already claimed for a run. */
  hasMessageIdempotencyKey(runId: RunId, idempotencyKey: string): Promise<boolean>;
}

/** Appends durable workflow events. */
export interface WorkflowEventAppender {
  /** Appends one durable event to a run's history. */
  appendEvent(runId: RunId, event: EventRecord): Promise<readonly EventRecord[]>;
}

/** Appends durable workflow events conditionally on the current run record. */
export interface WorkflowConditionalEventAppender {
  /** Appends one durable event only when the stored run still matches the current value. */
  appendEventIfRunCurrent(
    current: WorkflowRunRecord,
    event: EventRecord,
  ): Promise<readonly EventRecord[] | undefined>;
}

/** Reads durable workflow event history. */
export interface WorkflowEventReader {
  /** Returns all durable events recorded for a run. */
  getEvents(runId: RunId): Promise<readonly EventRecord[]>;
}

/** Waits for durable workflow event history changes. */
export interface WorkflowEventHistoryWatcher {
  /** Resolves after the durable event history for a run changes or the optional signal aborts. */
  waitForEventHistoryChange(
    runId: RunId,
    options?: WorkflowEventHistoryChangeWaitOptions,
  ): Promise<void>;
}

/** Stores durable workflow event history. */
export interface WorkflowEventLog
  extends
    WorkflowEventAppender,
    WorkflowConditionalEventAppender,
    WorkflowEventReader,
    WorkflowEventHistoryWatcher {}

/** Options for waiting for durable event history changes. */
export interface WorkflowEventHistoryChangeWaitOptions {
  readonly signal?: AbortSignal;
}

/** Looks up materialized step-attempt read models for runtime coordination. */
export interface WorkflowStepAttemptLookup {
  /** Lists materialized step attempts for a run. */
  listStepAttempts(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<readonly WorkflowStepAttemptRecord[]>;
}

/** Stores materialized step-attempt read models. */
export interface WorkflowStepAttemptReadModel extends WorkflowStepAttemptLookup {
  /** Lists one page of materialized step attempts for a run. */
  listStepAttemptsPage(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions & PageOptions,
  ): Promise<WorkflowPage<WorkflowStepAttemptRecord>>;
  /** Counts materialized step attempts for a run. */
  countStepAttempts(runId: RunId, options?: WorkflowListStepAttemptsOptions): Promise<number>;
  /** Rebuilds materialized step attempts for a run from its event history. */
  repairStepAttempts(runId: RunId): Promise<readonly WorkflowStepAttemptRecord[]>;
}

/** Stores workflow cleanup markers and terminal-run cleanup operations. */
export interface WorkflowCleanupRepository {
  /** Deletes terminal run data according to cleanup options. */
  cleanupRuns(options: CleanupRunsOptions): Promise<CleanupRunsResult>;
  /** Lists cleanup marker records. */
  listCleanupMarkers(): Promise<readonly CleanupMarkerRecord[]>;
}

/** Creates workflow schedule records. */
export interface WorkflowScheduleCreationRepository {
  /** Creates a workflow schedule record. */
  createSchedule<TInput = StorageValue>(
    schedule: ScheduleRecord<TInput>,
  ): Promise<ScheduleRecord<TInput>>;
}

/** Reads workflow schedule records. */
export interface WorkflowScheduleReaderRepository {
  /** Returns a workflow schedule by ID, if it exists. */
  getSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord | undefined>;
}

/** Updates workflow schedule records conditionally. */
export interface WorkflowScheduleConditionalWriterRepository {
  /** Replaces a schedule only when the stored record still matches the current value. */
  updateScheduleIfCurrent<TInput = StorageValue>(
    current: ScheduleRecord,
    next: ScheduleRecord<TInput>,
  ): Promise<ScheduleRecord<TInput> | undefined>;
}

/** Lists workflow schedule records. */
export interface WorkflowScheduleListerRepository {
  /** Lists workflow schedules matching optional filters. */
  listSchedules(options?: ListSchedulesOptions): Promise<readonly ScheduleRecord[]>;
}

/** Queries workflow schedule records. */
export interface WorkflowScheduleQueryRepository extends WorkflowScheduleListerRepository {
  /** Lists one page of workflow schedules matching optional filters. */
  listSchedulesPage(
    options?: ListSchedulesOptions & PageOptions,
  ): Promise<WorkflowPage<ScheduleRecord>>;
}

/** Stores workflow schedules. */
export interface WorkflowScheduleRepository
  extends
    WorkflowScheduleCreationRepository,
    WorkflowScheduleReaderRepository,
    WorkflowScheduleConditionalWriterRepository,
    WorkflowScheduleQueryRepository {}

/** Reads workflow lock records. */
export interface WorkflowLockReaderRepository {
  /** Returns a workflow lock by key, if it exists. */
  getLock(key: string): Promise<LockRecord | undefined>;
}

/** Lists workflow lock records. */
export interface WorkflowLockListerRepository {
  /** Lists workflow locks. */
  listLocks(): Promise<readonly LockRecord[]>;
}

/** Updates workflow lock records conditionally. */
export interface WorkflowLockConditionalWriterRepository {
  /** Replaces or creates a lock only when the stored record still matches the current value. */
  updateLockIfCurrent(
    current: LockRecord | undefined,
    next: LockRecord,
  ): Promise<LockRecord | undefined>;
}

/** Stores workflow lock records. */
export interface WorkflowLockRepository
  extends
    WorkflowLockReaderRepository,
    WorkflowLockListerRepository,
    WorkflowLockConditionalWriterRepository {}

/** Describes the full workflow store contract implemented by the default store. */
export interface WorkflowStore
  extends
    WorkflowStoreMetadata,
    WorkflowRunRepository,
    WorkflowIdempotencyIndex,
    WorkflowMessageIdempotencyIndexLookup,
    WorkflowMessageIdempotencyRepairModel,
    WorkflowEventLog,
    WorkflowStepAttemptReadModel,
    WorkflowCleanupRepository,
    WorkflowScheduleRepository,
    WorkflowLockRepository {}

/** Describes the workflow store capabilities contract. */
export interface WorkflowStoreCapabilities {
  readonly conditionalWrites: boolean;
  readonly conditionalRunClaims: boolean;
  readonly conditionalRunUpdates: boolean;
  readonly conditionalRunLeaseExtensions: boolean;
  readonly conditionalRunLeaseReleases: boolean;
  readonly conditionalEventAppends: boolean;
  readonly conditionalStepAttemptMaterialization: boolean;
  readonly atomicRunCreation: boolean;
  readonly atomicEventAndStepAttemptMaterialization: boolean;
  readonly messageIdempotencyIndexes: boolean;
  readonly indexedRunQueries: boolean;
  readonly indexedRunCounts: boolean;
  readonly indexedClaimableRunQueries: boolean;
  readonly indexedStepAttemptQueries: boolean;
  readonly indexedScheduleQueries: boolean;
  readonly indexedLockQueries: boolean;
  readonly rollsBackEventsOnMaterializationFailure: boolean;
  readonly reconcilesStepAttemptsFromEvents: boolean;
}

/** Options for workflow idempotency key. */
export interface WorkflowIdempotencyKeyOptions {
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly idempotencyKey: string;
}

/** Options for workflow claim run. */
export interface WorkflowClaimRunOptions extends WorkflowWorkerRunFilterOptions {
  readonly runId?: RunId;
  readonly workerId: string;
  readonly now: Temporal.Instant;
  readonly leaseDuration: Temporal.Duration;
}

/** Options for workflow extend run lease. */
export interface WorkflowExtendRunLeaseOptions {
  readonly runId: RunId;
  readonly workerId: string;
  readonly attempts?: number;
  readonly now: Temporal.Instant;
  readonly leaseDuration: Temporal.Duration;
}

/** Options for workflow release run lease. */
export interface WorkflowReleaseRunLeaseOptions {
  readonly runId: RunId;
  readonly workerId: string;
  readonly attempts?: number;
  readonly now: Temporal.Instant;
}
