import { createStorage, type StorageChangeEvent } from "@temelj/storage";

import type {
  CleanupMarkerRecord,
  CleanupRunsOptions,
  CleanupRunsResult,
} from "../types/cleanup.ts";
import type { EventRecord } from "../types/events.ts";
import type { LockRecord } from "../types/lock.ts";
import type { WorkflowPage } from "../types/pagination.ts";
import type {
  WorkflowListRunsOptions,
  WorkflowListRunsPageOptions,
  WorkflowListStepAttemptsPageOptions,
} from "../types/run-list.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type {
  ListSchedulesOptions,
  ListSchedulesPageOptions,
  ScheduleRecord,
} from "../types/schedule.ts";
import type {
  WorkflowListStepAttemptsOptions,
  WorkflowStepAttemptRecord,
} from "../types/step-attempts.ts";
import type {
  CreateWorkflowStoreOptions,
  WorkflowClaimRunOptions,
  WorkflowEventHistoryChangeWaitOptions,
  WorkflowExtendRunLeaseOptions,
  WorkflowIdempotencyKeyOptions,
  WorkflowReleaseRunLeaseOptions,
  WorkflowStore as WorkflowStoreContract,
  WorkflowStoreCapabilities,
  WorkflowMessageIdempotencyIndex,
  WorkflowStorage,
} from "../types/store.ts";

import { makeEventsKey } from "../store-keys.ts";
import { getWorkflowStoreCapabilities } from "./capabilities.ts";
import { cleanupRuns, listCleanupMarkers } from "./cleanup.ts";
import {
  appendWorkflowEvent,
  appendWorkflowEventIfRunCurrent,
  getWorkflowEvents,
} from "./event.ts";
import { createRunWithIdempotency, getRunByIdempotencyKey } from "./idempotency.ts";
import { getReadableLock, listReadableLocks, updateLockIfCurrent } from "./lock.ts";
import {
  hasMessageIdempotencyKey as hasWorkflowMessageIdempotencyKey,
  repairMessageIdempotencyIndexes as repairWorkflowMessageIdempotencyIndexes,
} from "./message-index.ts";
import {
  claimWorkflowRun,
  countWorkflowRuns,
  extendWorkflowRunLease,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflowRunsPage,
  releaseWorkflowRunLease,
  updateRunIfCurrent,
  updateWorkflowRun,
} from "./run.ts";
import {
  createSchedule,
  getReadableSchedule,
  listSchedules,
  listSchedulesPage,
  updateScheduleIfCurrent,
} from "./schedule.ts";
import {
  countWorkflowStepAttempts,
  listWorkflowStepAttempts,
  listWorkflowStepAttemptsPage,
  repairWorkflowStepAttempts,
} from "./step-attempt.ts";

export function createWorkflowStore(
  options: CreateWorkflowStoreOptions = {},
): WorkflowStoreContract {
  return new WorkflowStore(options);
}

/** Storage-backed workflow store implementation. */
export class WorkflowStore implements WorkflowStoreContract {
  readonly storage: WorkflowStorage;
  readonly namespace: string;
  readonly capabilities: WorkflowStoreCapabilities;

  constructor(options: CreateWorkflowStoreOptions = {}) {
    this.storage = options.storage ?? createStorage();
    this.namespace = options.namespace ?? "default";
    this.capabilities = getWorkflowStoreCapabilities(this.storage);
  }

  async createRun(run: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    return createRunWithIdempotency(this.storage, this.namespace, this, run);
  }

  async getRun(runId: RunId): Promise<WorkflowRunRecord | undefined> {
    return getWorkflowRun(this.storage, this.namespace, runId);
  }

  async getRunByIdempotencyKey(
    options: WorkflowIdempotencyKeyOptions,
  ): Promise<WorkflowRunRecord | undefined> {
    return getRunByIdempotencyKey(this.storage, this.namespace, this, options);
  }

  async updateRun(run: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    return updateWorkflowRun(this.storage, this.namespace, this, run);
  }

  async updateRunIfCurrent(
    current: WorkflowRunRecord,
    next: WorkflowRunRecord,
  ): Promise<WorkflowRunRecord | undefined> {
    return updateRunIfCurrent(this.storage, this.namespace, this, current, next);
  }

  async listRuns(options?: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]> {
    return listWorkflowRuns(this.storage, this.namespace, options);
  }

  async listRunsPage(
    options?: WorkflowListRunsPageOptions,
  ): Promise<WorkflowPage<WorkflowRunRecord>> {
    return listWorkflowRunsPage(this.storage, this.namespace, options);
  }

  async countRuns(options?: WorkflowListRunsOptions): Promise<number> {
    return countWorkflowRuns(this.storage, this.namespace, options);
  }

  async claimRun(options: WorkflowClaimRunOptions): Promise<WorkflowRunRecord | undefined> {
    return claimWorkflowRun(this.storage, this.namespace, this, options);
  }

  async extendRunLease(
    options: WorkflowExtendRunLeaseOptions,
  ): Promise<WorkflowRunRecord | undefined> {
    return extendWorkflowRunLease(this.storage, this.namespace, this, options);
  }

  async releaseRunLease(
    options: WorkflowReleaseRunLeaseOptions,
  ): Promise<WorkflowRunRecord | undefined> {
    return releaseWorkflowRunLease(this.storage, this.namespace, this, options);
  }

  async appendEvent(runId: RunId, event: EventRecord): Promise<readonly EventRecord[]> {
    return appendWorkflowEvent(this.storage, this.namespace, runId, event);
  }

  async appendEventIfRunCurrent(
    current: WorkflowRunRecord,
    event: EventRecord,
  ): Promise<readonly EventRecord[] | undefined> {
    return appendWorkflowEventIfRunCurrent(this.storage, this.namespace, current, event);
  }

  async getEvents(runId: RunId): Promise<readonly EventRecord[]> {
    return getWorkflowEvents(this.storage, this.namespace, runId);
  }

  async waitForEventHistoryChange(
    runId: RunId,
    options: WorkflowEventHistoryChangeWaitOptions = {},
  ): Promise<void> {
    if (options.signal?.aborted === true) {
      return;
    }
    const key = makeEventsKey(this.namespace, runId);
    await new Promise<void>((resolve) => {
      let settled = false;
      let unwatch: WorkflowStoreWatcherDisposer | undefined;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        options.signal?.removeEventListener("abort", finish);
        disposeWorkflowStoreWatcher(unwatch);
        resolve();
      };
      options.signal?.addEventListener("abort", finish, { once: true });
      void this.storage
        .watch((event) => {
          if (isWorkflowStorageChangeForKey(event, key)) {
            finish();
          }
        })
        .then((unsubscribe) => {
          unwatch = unsubscribe;
          if (settled) {
            disposeWorkflowStoreWatcher(unwatch);
          }
        })
        .catch(() => {
          finish();
        });
    });
  }

  async listStepAttempts(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<readonly WorkflowStepAttemptRecord[]> {
    return listWorkflowStepAttempts(this.storage, this.namespace, this, runId, options);
  }

  async listStepAttemptsPage(
    runId: RunId,
    options?: WorkflowListStepAttemptsPageOptions,
  ): Promise<WorkflowPage<WorkflowStepAttemptRecord>> {
    return listWorkflowStepAttemptsPage(this.storage, this.namespace, this, runId, options);
  }

  async countStepAttempts(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<number> {
    return countWorkflowStepAttempts(this.storage, this.namespace, this, runId, options);
  }

  async repairStepAttempts(runId: RunId): Promise<readonly WorkflowStepAttemptRecord[]> {
    return repairWorkflowStepAttempts(this.storage, this.namespace, this, runId);
  }

  async repairMessageIdempotencyIndexes(
    runId: RunId,
  ): Promise<readonly WorkflowMessageIdempotencyIndex[]> {
    return repairWorkflowMessageIdempotencyIndexes(this.storage, this.namespace, runId);
  }

  async hasMessageIdempotencyKey(runId: RunId, idempotencyKey: string): Promise<boolean> {
    return hasWorkflowMessageIdempotencyKey(this.storage, this.namespace, runId, idempotencyKey);
  }

  async cleanupRuns(options: CleanupRunsOptions): Promise<CleanupRunsResult> {
    return cleanupRuns(this.storage, this.namespace, this, options);
  }

  async listCleanupMarkers(): Promise<readonly CleanupMarkerRecord[]> {
    return listCleanupMarkers(this.storage, this.namespace);
  }

  async createSchedule<TInput>(schedule: ScheduleRecord<TInput>): Promise<ScheduleRecord<TInput>> {
    return createSchedule(this.storage, this.namespace, schedule);
  }

  async getSchedule(scheduleId: string): Promise<ScheduleRecord | undefined> {
    return getReadableSchedule(this.storage, this.namespace, scheduleId);
  }

  async updateScheduleIfCurrent<TInput>(
    current: ScheduleRecord,
    next: ScheduleRecord<TInput>,
  ): Promise<ScheduleRecord<TInput> | undefined> {
    return updateScheduleIfCurrent(this.storage, this.namespace, current, next);
  }

  async listSchedules(options?: ListSchedulesOptions): Promise<readonly ScheduleRecord[]> {
    return listSchedules(this.storage, this.namespace, options);
  }

  async listSchedulesPage(
    options?: ListSchedulesPageOptions,
  ): Promise<WorkflowPage<ScheduleRecord>> {
    return listSchedulesPage(this.storage, this.namespace, options);
  }

  async getLock(key: string): Promise<LockRecord | undefined> {
    return getReadableLock(this.storage, this.namespace, key);
  }

  async listLocks(): Promise<readonly LockRecord[]> {
    return listReadableLocks(this.storage, this.namespace);
  }

  async updateLockIfCurrent(
    current: LockRecord | undefined,
    next: LockRecord,
  ): Promise<LockRecord | undefined> {
    return updateLockIfCurrent(this.storage, this.namespace, current, next);
  }
}

type WorkflowStoreWatcherDisposer = () => void | Promise<void>;

function disposeWorkflowStoreWatcher(unwatch: WorkflowStoreWatcherDisposer | undefined): void {
  if (unwatch === undefined) {
    return;
  }
  ignoreWorkflowStoreWatcherDisposal(unwatch());
}

function ignoreWorkflowStoreWatcherDisposal(result: void | Promise<void>): void {
  if (result === undefined) {
    return;
  }
  void result.catch(() => {});
}

function isWorkflowStorageChangeForKey(event: StorageChangeEvent, key: string): boolean {
  switch (event.type) {
    case "set":
    case "delete":
      return event.key === key;
    case "setMany":
    case "deleteMany":
      return event.keys.includes(key);
    case "clear":
      return event.prefix === undefined || key.startsWith(event.prefix);
  }
}
