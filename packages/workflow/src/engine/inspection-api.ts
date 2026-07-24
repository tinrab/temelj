import type { EventRecord } from "../types/events.ts";
import type { WorkflowPage, PageOptions } from "../types/pagination.ts";
import type {
  WorkflowListRunsOptions,
  WorkflowListRunsPageOptions,
  WorkflowListStepAttemptsPageOptions,
} from "../types/run-list.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type {
  WorkflowListStepAttemptsOptions,
  WorkflowStepAttemptRecord,
  WorkflowStepAttemptSummary,
} from "../types/step-attempts.ts";
import type {
  WorkflowMessageIdempotencyIndex,
  WorkflowEventReader,
  WorkflowLockListerRepository,
  WorkflowRunQueryRepository,
  WorkflowScheduleListerRepository,
  WorkflowStepAttemptReadModel,
} from "../types/store.ts";
import type {
  WorkflowRecoverySummary,
  WorkflowRecoverySummaryOptions,
  WorkflowRunSummary,
  WorkflowRunSummaryOptions,
} from "../types/summary.ts";
import type { Timeline } from "../types/timeline.ts";

import { createTimeline } from "../history/mod.ts";
import { pageItems, makeWorkflowEventCursorKey } from "../pagination.ts";
import { getWorkflowRecoverySummary, getWorkflowRunSummary } from "./inspection.ts";
import { getRequiredRun } from "./state.ts";
import { getChildRunsForAttempts } from "./summary/child-workflow-runs.ts";
import { createWorkflowStepAttemptSummaryReducer } from "./summary/step-attempts.ts";

export interface WorkflowEngineInspectionApi {
  getRun(runId: RunId): Promise<WorkflowRunRecord | undefined>;
  getEvents(runId: RunId): Promise<readonly EventRecord[]>;
  listEventsPage(runId: RunId, options?: PageOptions): Promise<WorkflowPage<EventRecord>>;
  listRuns(options?: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]>;
  listRunsPage(options?: WorkflowListRunsPageOptions): Promise<WorkflowPage<WorkflowRunRecord>>;
  countRuns(options?: WorkflowListRunsOptions): Promise<number>;
  getRunSummary(options?: WorkflowRunSummaryOptions): Promise<WorkflowRunSummary>;
  getRecoverySummary(options?: WorkflowRecoverySummaryOptions): Promise<WorkflowRecoverySummary>;
  getTimeline(runId: RunId): Promise<Timeline>;
  listStepAttempts(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<readonly WorkflowStepAttemptRecord[]>;
  listStepAttemptsPage(
    runId: RunId,
    options?: WorkflowListStepAttemptsPageOptions,
  ): Promise<WorkflowPage<WorkflowStepAttemptRecord>>;
  countStepAttempts(runId: RunId, options?: WorkflowListStepAttemptsOptions): Promise<number>;
  repairStepAttempts(runId: RunId): Promise<readonly WorkflowStepAttemptRecord[]>;
  repairMessageIdempotencyIndexes(
    runId: RunId,
  ): Promise<readonly WorkflowMessageIdempotencyIndex[]>;
  getStepAttemptSummary(
    runId: RunId,
    options?: WorkflowListStepAttemptsOptions,
  ): Promise<WorkflowStepAttemptSummary>;
}

interface WorkflowInspectionRepairStore {
  repairMessageIdempotencyIndexes(
    runId: RunId,
  ): Promise<readonly WorkflowMessageIdempotencyIndex[]>;
}

type WorkflowEngineInspectionStore = WorkflowRunQueryRepository &
  WorkflowEventReader &
  WorkflowInspectionRepairStore &
  WorkflowStepAttemptReadModel &
  WorkflowLockListerRepository &
  WorkflowScheduleListerRepository;

export function createWorkflowEngineInspectionApi(
  store: WorkflowEngineInspectionStore,
  now: () => Temporal.Instant,
): WorkflowEngineInspectionApi {
  return {
    async getRun(runId) {
      return await store.getRun(runId);
    },

    async getEvents(runId) {
      return await store.getEvents(runId);
    },

    async listEventsPage(runId, options) {
      return pageItems(
        await store.getEvents(runId),
        options,
        "Workflow event page",
        makeWorkflowEventCursorKey,
      );
    },

    async listRuns(options) {
      return await store.listRuns(options);
    },

    async listRunsPage(options) {
      return await store.listRunsPage(options);
    },

    async countRuns(options) {
      return await store.countRuns(options);
    },

    async getRunSummary(options) {
      return await getWorkflowRunSummary({
        store,
        now: now(),
        filters: options,
      });
    },

    async getRecoverySummary(options) {
      return await getWorkflowRecoverySummary({
        store,
        now: now(),
        filters: options,
      });
    },

    async getTimeline(runId) {
      const run = await getRequiredRun(store, runId);
      return createTimeline(run, await store.getEvents(runId));
    },

    async listStepAttempts(runId, options?: WorkflowListStepAttemptsOptions) {
      await getRequiredRun(store, runId);
      return await store.listStepAttempts(runId, options);
    },

    async listStepAttemptsPage(runId, options) {
      await getRequiredRun(store, runId);
      return await store.listStepAttemptsPage(runId, options);
    },

    async countStepAttempts(runId, options?: WorkflowListStepAttemptsOptions) {
      await getRequiredRun(store, runId);
      return await store.countStepAttempts(runId, options);
    },

    async repairStepAttempts(runId) {
      await getRequiredRun(store, runId);
      return await store.repairStepAttempts(runId);
    },

    async repairMessageIdempotencyIndexes(runId) {
      await getRequiredRun(store, runId);
      return await store.repairMessageIdempotencyIndexes(runId);
    },

    async getStepAttemptSummary(runId, options?: WorkflowListStepAttemptsOptions) {
      await getRequiredRun(store, runId);
      const attempts = await store.listStepAttempts(runId, options);
      const reducer = createWorkflowStepAttemptSummaryReducer(
        await getChildRunsForAttempts(store, runId, attempts),
      );
      for (const attempt of attempts) {
        reducer.addAttempt(attempt);
      }
      return reducer.finish();
    },
  };
}
