import type { Storage, StorageValue, StoredValue } from "@temelj/storage";

import type { CleanupMarkerRecord, CleanupRunsOptions, CleanupRunsResult } from "./cleanup.ts";
import type { EventRecord } from "./events.ts";
import type { MessageId, RunId } from "./ids.ts";
import type { LockRecord } from "./lock.ts";
import type { WorkflowPage, PageOptions } from "./pagination.ts";
import type { ListRunsOptions } from "./run-list.ts";
import type { RunRecord } from "./run.ts";
import type { ScheduleId, ListSchedulesOptions, ScheduleRecord } from "./schedule.ts";
import type { ListStepAttemptsOptions, StepAttemptRecord } from "./step-attempts.ts";
import type { WorkerRunFilterOptions } from "./worker.ts";

export type WorkflowStorage = Storage<Record<string, StorageValue>, StorageValue, StoredValue>;

/** Storage index entry removed during workflow cleanup. */
export interface CleanupIndexKey {
  readonly key: string;
  readonly value: StorageValue;
}

/** Index entry used to detect duplicate messageId delivery idempotency keys. */
export interface MessageIdempotencyIndex {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly timestamp: Temporal.Instant;
}

export interface CreateWorkflowStoreOptions {
  readonly storage?: WorkflowStorage;
  readonly namespace?: string;
}

/** Durable records of one namespace: runs, events, step attempts, schedules, and locks. */
export interface WorkflowStore {
  /** Prefix that isolates this store's records in storage. */
  readonly namespace: string;
  readonly storage: WorkflowStorage;
  /** What the storage guarantees, so the engine can pick safe coordination paths. */
  readonly capabilities: StoreCapabilities;

  // Runs.
  createRun(run: RunRecord): Promise<RunRecord>;
  getRun(runId: RunId): Promise<RunRecord | undefined>;
  getRunByIdempotencyKey(options: IdempotencyKeyOptions): Promise<RunRecord | undefined>;
  updateRun(run: RunRecord): Promise<RunRecord>;
  /** Replaces a run only when the stored record still equals `current`. */
  updateRunIfCurrent(current: RunRecord, next: RunRecord): Promise<RunRecord | undefined>;
  listRuns(options?: ListRunsOptions): Promise<readonly RunRecord[]>;
  listRunsPage(options?: ListRunsOptions & PageOptions): Promise<WorkflowPage<RunRecord>>;
  countRuns(options?: ListRunsOptions): Promise<number>;
  /** Claims a pending or reclaimable run for a worker. */
  claimRun(options: ClaimRunOptions): Promise<RunRecord | undefined>;
  extendRunLease(options: ExtendRunLeaseOptions): Promise<RunRecord | undefined>;
  releaseRunLease(options: ReleaseRunLeaseOptions): Promise<RunRecord | undefined>;

  // Events.
  appendEvent(runId: RunId, event: EventRecord): Promise<readonly EventRecord[]>;
  /** Appends an event only when the stored run still equals `current`. */
  appendEventIfRunCurrent(
    current: RunRecord,
    event: EventRecord,
  ): Promise<readonly EventRecord[] | undefined>;
  getEvents(runId: RunId): Promise<readonly EventRecord[]>;
  /** Resolves after the run's event history changes, or when `signal` aborts. */
  waitForEventHistoryChange(
    runId: RunId,
    options?: WorkflowEventHistoryChangeWaitOptions,
  ): Promise<void>;

  // Message idempotency.
  hasMessageIdempotencyKey(runId: RunId, idempotencyKey: string): Promise<boolean>;
  /** Rebuilds a run's message idempotency indexes from its event history. */
  repairMessageIdempotencyIndexes(runId: RunId): Promise<readonly MessageIdempotencyIndex[]>;

  // Step attempts, materialized from events.
  listStepAttempts(
    runId: RunId,
    options?: ListStepAttemptsOptions,
  ): Promise<readonly StepAttemptRecord[]>;
  listStepAttemptsPage(
    runId: RunId,
    options?: ListStepAttemptsOptions & PageOptions,
  ): Promise<WorkflowPage<StepAttemptRecord>>;
  countStepAttempts(runId: RunId, options?: ListStepAttemptsOptions): Promise<number>;
  /** Rebuilds a run's step attempts from its event history. */
  repairStepAttempts(runId: RunId): Promise<readonly StepAttemptRecord[]>;

  // Cleanup.
  cleanupRuns(options: CleanupRunsOptions): Promise<CleanupRunsResult>;
  listCleanupMarkers(): Promise<readonly CleanupMarkerRecord[]>;

  // Schedules.
  createSchedule(schedule: ScheduleRecord): Promise<ScheduleRecord>;
  getSchedule(scheduleId: ScheduleId): Promise<ScheduleRecord | undefined>;
  updateScheduleIfCurrent(
    current: ScheduleRecord,
    next: ScheduleRecord,
  ): Promise<ScheduleRecord | undefined>;
  listSchedules(options?: ListSchedulesOptions): Promise<readonly ScheduleRecord[]>;
  listSchedulesPage(
    options?: ListSchedulesOptions & PageOptions,
  ): Promise<WorkflowPage<ScheduleRecord>>;

  // Locks.
  getLock(key: string): Promise<LockRecord | undefined>;
  listLocks(): Promise<readonly LockRecord[]>;
  /** Creates or replaces a lock only when the stored record still equals `current`. */
  updateLockIfCurrent(
    current: LockRecord | undefined,
    next: LockRecord,
  ): Promise<LockRecord | undefined>;
}

export interface WorkflowEventHistoryChangeWaitOptions {
  readonly signal?: AbortSignal;
}

export interface StoreCapabilities {
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

export interface IdempotencyKeyOptions {
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly idempotencyKey: string;
}

export interface ClaimRunOptions extends WorkerRunFilterOptions {
  readonly runId?: RunId;
  readonly workerId: string;
  readonly now: Temporal.Instant;
  readonly leaseDuration: Temporal.Duration;
}

export interface ExtendRunLeaseOptions {
  readonly runId: RunId;
  readonly workerId: string;
  readonly attempts?: number;
  readonly now: Temporal.Instant;
  readonly leaseDuration: Temporal.Duration;
}

export interface ReleaseRunLeaseOptions {
  readonly runId: RunId;
  readonly workerId: string;
  readonly attempts?: number;
  readonly now: Temporal.Instant;
}
