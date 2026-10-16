import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { WorkflowPage } from "../types/pagination.ts";
import type { ListRunsOptions, ListStepAttemptsPageOptions } from "../types/run-list.ts";
import type { MaterializedStepType, RunRecord } from "../types/run.ts";
import type {
  ListStepAttemptsOptions,
  StepAttemptRecord,
  StepAttemptSummary,
} from "../types/step-attempts.ts";
import type { WorkflowStore } from "../types/store.ts";
import type { RecoverySummary, RunSummary } from "../types/summary.ts";
import type { Timeline } from "../types/timeline.ts";
import type { EngineContext } from "./context.ts";
import type {
  RunAttemptsInput,
  RunChildWorkflowWaitInput,
  RunEventActivityInput,
  RunSummaryInputs,
} from "./summary/runs.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowOptionsError } from "../errors/mod.ts";
import { createTimeline } from "../history/replay.ts";
import { isActiveRunStatus, isRunStatus } from "../run-status.ts";
import { getRequiredRun } from "../store/query.ts";
import { summarizeRecovery, type RecoverySummaryInputs } from "./summary/recovery.ts";
import { getChildRunsForAttempts, summarizeRuns } from "./summary/runs.ts";
import { summarizeStepAttempts } from "./summary/step-attempts.ts";

interface RunSummaryActivityInputs {
  readonly runningChildWorkflows: readonly RunChildWorkflowWaitInput[];
  readonly runningSleeps: readonly RunAttemptsInput[];
  readonly runningMessageWaits: readonly RunAttemptsInput[];
  readonly runningEvents: readonly RunEventActivityInput[];
}

function isKnownRunStatus(run: RunRecord): boolean {
  return isRunStatus(run.status);
}

function workflowRunCanHaveActiveWork(run: RunRecord): boolean {
  return isActiveRunStatus(run.status);
}

function workflowSummaryCleanupCutoff(
  filters: ListRunsOptions | undefined,
): Temporal.Instant | undefined {
  if (filters?.cleanupFinishedAtBefore === undefined) {
    return undefined;
  }

  const value = filters.cleanupFinishedAtBefore;

  if (!(value instanceof Temporal.Instant)) {
    throw new WorkflowOptionsError("Workflow cleanup finishedAtBefore must be a Temporal.Instant", {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_TEMPORAL_INSTANT,
      details: { label: "Workflow cleanup finishedAtBefore" },
    });
  }

  return value;
}

async function listRunStepAttempts(
  store: WorkflowStore,
  runId: RunId,
  options: ListStepAttemptsOptions,
): Promise<readonly StepAttemptRecord[]> {
  return await store.listStepAttempts(runId, options);
}

async function listActiveRunStepAttempts(
  store: WorkflowStore,
  run: RunRecord,
  kind: MaterializedStepType,
): Promise<readonly StepAttemptRecord[]> {
  return workflowRunCanHaveActiveWork(run)
    ? await listRunStepAttempts(store, run.id, { status: "running", kind })
    : [];
}

async function getRunSummaryActivityInputs(
  store: WorkflowStore,
  runs: readonly RunRecord[],
): Promise<RunSummaryActivityInputs> {
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
  store: WorkflowStore,
  runs: readonly RunRecord[],
): Promise<readonly RunChildWorkflowWaitInput[]> {
  return await Promise.all(
    runs.map(async (run) => {
      if (!isKnownRunStatus(run)) {
        return {
          runId: run.id,
          attempts: [],
          childRuns: [],
        };
      }

      const attempts = await listRunStepAttempts(store, run.id, {
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
  store: WorkflowStore,
  runs: readonly RunRecord[],
  kind: "sleep",
): Promise<readonly RunAttemptsInput[]>;
async function listRunningStepWaits(
  store: WorkflowStore,
  runs: readonly RunRecord[],
  kind: "message-wait",
): Promise<readonly RunAttemptsInput[]>;
async function listRunningStepWaits(
  store: WorkflowStore,
  runs: readonly RunRecord[],
  kind: "sleep" | "message-wait",
): Promise<readonly RunAttemptsInput[]> {
  return await Promise.all(
    runs.map(async (run) => {
      return {
        runId: run.id,
        attempts: await listActiveRunStepAttempts(store, run, kind),
      };
    }),
  );
}

async function listRunningEventActivity(
  store: WorkflowStore,
  runs: readonly RunRecord[],
): Promise<readonly RunEventActivityInput[]> {
  return await Promise.all(
    runs.map(async (run) => {
      return {
        runId: run.id,
        events: workflowRunCanHaveActiveWork(run) ? await store.getEvents(run.id) : [],
      };
    }),
  );
}

async function listRunAttemptGroups(
  store: WorkflowStore,
  runs: readonly RunRecord[],
  options: ListStepAttemptsOptions,
): Promise<readonly (readonly StepAttemptRecord[])[]> {
  return await Promise.all(runs.map((run) => listRunStepAttempts(store, run.id, options)));
}

export async function getWorkflowRunSummary(options: {
  readonly store: WorkflowStore;
  readonly now: Temporal.Instant;
  readonly filters?: ListRunsOptions;
}): Promise<RunSummary> {
  const { store, now, filters } = options;
  const cleanupCutoff = workflowSummaryCleanupCutoff(filters);
  const runs = await store.listRuns(filters);

  const summaryInputs = {
    runs,
    now,
    cleanupCutoff,
    ...(await getRunSummaryActivityInputs(store, runs)),
  } satisfies RunSummaryInputs;

  return summarizeRuns(summaryInputs);
}

export async function getWorkflowRecoverySummary(options: {
  readonly store: WorkflowStore;
  readonly now: Temporal.Instant;
  readonly filters?: ListRunsOptions;
}): Promise<RecoverySummary> {
  const { store, now, filters } = options;
  const runs = await store.listRuns(filters);

  const activeRuns = runs.filter((run) => {
    return workflowRunCanHaveActiveWork(run);
  });

  return summarizeRecovery({
    runs,
    now,
    inputs: await getRecoverySummaryInputs(store, activeRuns),
  });
}

async function getRecoverySummaryInputs(
  store: WorkflowStore,
  activeRuns: readonly RunRecord[],
): Promise<RecoverySummaryInputs> {
  const [
    sleepAttemptGroups,
    messageWaitAttemptGroups,
    childWorkflowAttemptGroups,
    lockWaitAttemptGroups,
    eventsByRunId,
    locks,
    schedules,
  ] = await Promise.all([
    listRunAttemptGroups(store, activeRuns, { status: "running", kind: "sleep" }),
    listRunAttemptGroups(store, activeRuns, { status: "running", kind: "message-wait" }),
    listChildWorkflowAttemptGroups(store, activeRuns),
    listRunAttemptGroups(store, activeRuns, { status: "failed", kind: "run" }),
    getRecoveryEventsByRunId(store, activeRuns),
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
  store: WorkflowStore,
  activeRuns: readonly RunRecord[],
): Promise<readonly RunChildWorkflowWaitInput[]> {
  const childWorkflowAttemptGroups = await Promise.all(
    activeRuns.map(async (run) => {
      const attempts = await listRunStepAttempts(store, run.id, {
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

async function getRecoveryEventsByRunId(
  store: WorkflowStore,
  activeRuns: readonly RunRecord[],
): Promise<ReadonlyMap<RunId, readonly EventRecord[]>> {
  return new Map(
    await Promise.all(
      activeRuns.map(async (run) => [run.id, await store.getEvents(run.id)] as const),
    ),
  );
}

/** A page of a run's step attempts. */
export async function pageRunStepAttempts(
  { store }: EngineContext,
  runId: RunId,
  options?: ListStepAttemptsPageOptions,
): Promise<WorkflowPage<StepAttemptRecord>> {
  await getRequiredRun(store, runId);

  return await store.listStepAttemptsPage(runId, options);
}

export async function countRunStepAttempts(
  { store }: EngineContext,
  runId: RunId,
  options?: ListStepAttemptsOptions,
): Promise<number> {
  await getRequiredRun(store, runId);

  return await store.countStepAttempts(runId, options);
}

/** A run's step attempts, with the child runs its workflow steps started. */
export async function getRunStepAttemptSummary(
  { store }: EngineContext,
  runId: RunId,
  options?: ListStepAttemptsOptions,
): Promise<StepAttemptSummary> {
  await getRequiredRun(store, runId);
  const attempts = await store.listStepAttempts(runId, options);

  return summarizeStepAttempts(attempts, await getChildRunsForAttempts(store, runId, attempts));
}

export async function getRunTimeline({ store }: EngineContext, runId: RunId): Promise<Timeline> {
  const run = await getRequiredRun(store, runId);

  return createTimeline(run, await store.getEvents(runId));
}
