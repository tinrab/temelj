import type { EventRecord } from "../types/events.ts";
import type { RunId, WorkflowMaterializedStepType, WorkflowRunRecord } from "../types/run.ts";
import type {
  WorkflowListStepAttemptsOptions,
  WorkflowStepAttemptRecord,
} from "../types/step-attempts.ts";
import type {
  WorkflowEventReader,
  WorkflowLockListerRepository,
  WorkflowRunListerRepository,
  WorkflowRunReaderRepository,
  WorkflowScheduleListerRepository,
  WorkflowStepAttemptLookup,
} from "../types/store.ts";
import type {
  WorkflowRecoverySummary,
  WorkflowRecoverySummaryOptions,
  WorkflowRunSummary,
  WorkflowRunSummaryOptions,
} from "../types/summary.ts";
import type { WorkflowRecoverySummaryInputs } from "./recovery.ts";
import type {
  WorkflowRunEventActivityInput,
  WorkflowRunMessageWaitInput,
  WorkflowRunSummaryInputs,
  WorkflowRunSleepWaitInput,
} from "./summary.ts";
import type { WorkflowRunChildWorkflowWaitInput } from "./summary/child-workflow-waits.ts";

import { WorkflowOptionsError } from "../errors/mod.ts";
import { isActiveWorkflowRunStatus, isWorkflowRunStatus } from "../utility.ts";
import { summarizeWorkflowRecovery } from "./recovery.ts";
import { summarizeWorkflowRuns } from "./summary.ts";
import { getChildRunsForAttempts } from "./summary/child-workflow-runs.ts";

type WorkflowSummaryRunStore = WorkflowRunReaderRepository & WorkflowRunListerRepository;

type WorkflowRunSummaryStore = WorkflowSummaryRunStore &
  WorkflowEventReader &
  WorkflowStepAttemptLookup;

type WorkflowRecoverySummaryStore = WorkflowRunSummaryStore &
  WorkflowLockListerRepository &
  WorkflowScheduleListerRepository;

interface WorkflowRunSummaryActivityInputs {
  readonly runningChildWorkflows: readonly WorkflowRunChildWorkflowWaitInput[];
  readonly runningSleeps: readonly WorkflowRunSleepWaitInput[];
  readonly runningMessageWaits: readonly WorkflowRunMessageWaitInput[];
  readonly runningEvents: readonly WorkflowRunEventActivityInput[];
}

function isKnownWorkflowRunStatus(run: WorkflowRunRecord): boolean {
  return isWorkflowRunStatus(run.status);
}

function workflowRunCanHaveActiveWork(run: WorkflowRunRecord): boolean {
  return isActiveWorkflowRunStatus(run.status);
}

function workflowSummaryCleanupCutoff(
  filters: WorkflowRunSummaryOptions | undefined,
): Temporal.Instant | undefined {
  if (filters?.cleanupFinishedAtBefore === undefined) {
    return undefined;
  }
  const value = filters.cleanupFinishedAtBefore;
  if (!(value instanceof Temporal.Instant)) {
    WorkflowOptionsError.temporalInstant("Workflow cleanup finishedAtBefore");
  }
  return value;
}

async function listWorkflowRunStepAttempts(
  store: WorkflowStepAttemptLookup,
  runId: RunId,
  options: WorkflowListStepAttemptsOptions,
): Promise<readonly WorkflowStepAttemptRecord[]> {
  return await store.listStepAttempts(runId, options);
}

async function listActiveWorkflowRunStepAttempts(
  store: WorkflowStepAttemptLookup,
  run: WorkflowRunRecord,
  kind: WorkflowMaterializedStepType,
): Promise<readonly WorkflowStepAttemptRecord[]> {
  return workflowRunCanHaveActiveWork(run)
    ? await listWorkflowRunStepAttempts(store, run.id, { status: "running", kind })
    : [];
}

async function getWorkflowRunSummaryActivityInputs(
  store: WorkflowRunSummaryStore,
  runs: readonly WorkflowRunRecord[],
): Promise<WorkflowRunSummaryActivityInputs> {
  const [runningChildWorkflows, runningSleeps, runningMessageWaits, runningEvents] =
    await Promise.all([
      listRunningChildWorkflowWaits(store, runs),
      listRunningStepWaits(store, runs, "sleep"),
      listRunningStepWaits(store, runs, "message-wait"),
      listRunningEventActivity(store, runs),
    ]);
  return {
    runningChildWorkflows,
    runningSleeps,
    runningMessageWaits,
    runningEvents,
  };
}

async function listRunningChildWorkflowWaits(
  store: WorkflowRunSummaryStore,
  runs: readonly WorkflowRunRecord[],
): Promise<readonly WorkflowRunChildWorkflowWaitInput[]> {
  return await Promise.all(
    runs.map(async (run) => {
      if (!isKnownWorkflowRunStatus(run)) {
        return {
          runId: run.id,
          attempts: [],
          childRuns: [],
        };
      }
      const attempts = await listWorkflowRunStepAttempts(store, run.id, {
        status: "running",
        kind: "workflow",
      });
      return {
        runId: run.id,
        attempts,
        childRuns: await getChildRunsForAttempts(store, run.id, attempts),
      };
    }),
  );
}

async function listRunningStepWaits(
  store: WorkflowStepAttemptLookup,
  runs: readonly WorkflowRunRecord[],
  kind: "sleep",
): Promise<readonly WorkflowRunSleepWaitInput[]>;
async function listRunningStepWaits(
  store: WorkflowStepAttemptLookup,
  runs: readonly WorkflowRunRecord[],
  kind: "message-wait",
): Promise<readonly WorkflowRunMessageWaitInput[]>;
async function listRunningStepWaits(
  store: WorkflowStepAttemptLookup,
  runs: readonly WorkflowRunRecord[],
  kind: "sleep" | "message-wait",
): Promise<readonly (WorkflowRunSleepWaitInput | WorkflowRunMessageWaitInput)[]> {
  return await Promise.all(
    runs.map(async (run) => {
      return {
        runId: run.id,
        attempts: await listActiveWorkflowRunStepAttempts(store, run, kind),
      };
    }),
  );
}

async function listRunningEventActivity(
  store: WorkflowEventReader,
  runs: readonly WorkflowRunRecord[],
): Promise<readonly WorkflowRunEventActivityInput[]> {
  return await Promise.all(
    runs.map(async (run) => {
      return {
        runId: run.id,
        events: workflowRunCanHaveActiveWork(run) ? await store.getEvents(run.id) : [],
      };
    }),
  );
}

async function listWorkflowRunAttemptGroups(
  store: WorkflowStepAttemptLookup,
  runs: readonly WorkflowRunRecord[],
  options: WorkflowListStepAttemptsOptions,
): Promise<readonly (readonly WorkflowStepAttemptRecord[])[]> {
  return await Promise.all(
    runs.map(async (run) => await listWorkflowRunStepAttempts(store, run.id, options)),
  );
}

export async function getWorkflowRunSummary(options: {
  readonly store: WorkflowRunSummaryStore;
  readonly now: Temporal.Instant;
  readonly filters?: WorkflowRunSummaryOptions;
}): Promise<WorkflowRunSummary> {
  const { store, now, filters } = options;
  const cleanupCutoff = workflowSummaryCleanupCutoff(filters);
  const runs = await store.listRuns(filters);
  const summaryInputs = {
    runs,
    now,
    cleanupCutoff,
    ...(await getWorkflowRunSummaryActivityInputs(store, runs)),
  } satisfies WorkflowRunSummaryInputs;
  return summarizeWorkflowRuns(summaryInputs);
}

export async function getWorkflowRecoverySummary(options: {
  readonly store: WorkflowRecoverySummaryStore;
  readonly now: Temporal.Instant;
  readonly filters?: WorkflowRecoverySummaryOptions;
}): Promise<WorkflowRecoverySummary> {
  const { store, now, filters } = options;
  const runs = await store.listRuns(filters);
  const activeRuns = runs.filter((run) => {
    return workflowRunCanHaveActiveWork(run);
  });
  return summarizeWorkflowRecovery({
    runs,
    now,
    inputs: await getWorkflowRecoverySummaryInputs(store, activeRuns),
  });
}

async function getWorkflowRecoverySummaryInputs(
  store: WorkflowRecoverySummaryStore,
  activeRuns: readonly WorkflowRunRecord[],
): Promise<WorkflowRecoverySummaryInputs> {
  const [
    sleepAttemptGroups,
    messageWaitAttemptGroups,
    childWorkflowAttemptGroups,
    lockWaitAttemptGroups,
    eventsByRunId,
    locks,
    schedules,
  ] = await Promise.all([
    listWorkflowRunAttemptGroups(store, activeRuns, { status: "running", kind: "sleep" }),
    listWorkflowRunAttemptGroups(store, activeRuns, { status: "running", kind: "message-wait" }),
    listChildWorkflowAttemptGroups(store, activeRuns),
    listWorkflowRunAttemptGroups(store, activeRuns, { status: "failed", kind: "run" }),
    getWorkflowRecoveryEventsByRunId(store, activeRuns),
    store.listLocks(),
    store.listSchedules(),
  ]);

  return {
    sleepAttempts: sleepAttemptGroups.flat(),
    messageWaitAttempts: messageWaitAttemptGroups.flat(),
    childWorkflowAttempts: childWorkflowAttemptGroups.flatMap((group) => group.attempts),
    lockWaitAttempts: lockWaitAttemptGroups.flat(),
    childRuns: childWorkflowAttemptGroups.flatMap((group) => group.childRuns),
    eventsByRunId,
    locks,
    schedules,
  };
}

async function listChildWorkflowAttemptGroups(
  store: WorkflowRunSummaryStore,
  activeRuns: readonly WorkflowRunRecord[],
): Promise<readonly WorkflowRunChildWorkflowWaitInput[]> {
  const childWorkflowAttemptGroups = await Promise.all(
    activeRuns.map(async (run) => {
      const attempts = await listWorkflowRunStepAttempts(store, run.id, {
        status: "running",
        kind: "workflow",
      });
      return {
        runId: run.id,
        attempts,
        childRuns: await getChildRunsForAttempts(store, run.id, attempts),
      };
    }),
  );
  return childWorkflowAttemptGroups;
}

async function getWorkflowRecoveryEventsByRunId(
  store: WorkflowEventReader,
  activeRuns: readonly WorkflowRunRecord[],
): Promise<ReadonlyMap<RunId, readonly EventRecord[]>> {
  return new Map(
    await Promise.all(
      activeRuns.map(async (run) => [run.id, await store.getEvents(run.id)] as const),
    ),
  );
}
