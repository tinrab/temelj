import type { EventRecord } from "../types/events.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../types/step-attempts.ts";
import type { WorkflowRunSummary } from "../types/summary.ts";

import { activeWorkflowEvents } from "./summary/active-events.ts";
import {
  createWorkflowRunChildWorkflowWaitSummaryReducer,
  type WorkflowRunChildWorkflowWaitInput,
} from "./summary/child-workflow-waits.ts";
import { createWorkflowRunHookActivitySummaryReducer } from "./summary/run-hooks.ts";
import { createWorkflowRunMessageWaitSummaryReducer } from "./summary/run-message-waits.ts";
import { createWorkflowRunSleepWaitSummaryReducer } from "./summary/run-sleeps.ts";
import { createWorkflowRunStateSummaryReducer } from "./summary/run-state.ts";
import { createWorkflowRunStreamActivitySummaryReducer } from "./summary/run-streams.ts";

export interface WorkflowRunEventActivityInput {
  readonly runId: RunId;
  readonly events: readonly EventRecord[];
}

export interface WorkflowRunSleepWaitInput {
  readonly runId: RunId;
  readonly attempts: readonly WorkflowStepAttemptRecord[];
}

export interface WorkflowRunMessageWaitInput {
  readonly runId: RunId;
  readonly attempts: readonly WorkflowStepAttemptRecord[];
}

export interface WorkflowRunSummaryInputs {
  readonly runs: readonly WorkflowRunRecord[];
  readonly now: Temporal.Instant;
  readonly cleanupCutoff?: Temporal.Instant;
  readonly runningChildWorkflows?: readonly WorkflowRunChildWorkflowWaitInput[];
  readonly runningSleeps?: readonly WorkflowRunSleepWaitInput[];
  readonly runningMessageWaits?: readonly WorkflowRunMessageWaitInput[];
  readonly runningEvents?: readonly WorkflowRunEventActivityInput[];
}

/** Summarizes workflow run records and active wait events for inspection dashboards. */
export function summarizeWorkflowRuns(inputs: WorkflowRunSummaryInputs): WorkflowRunSummary {
  const {
    runs,
    now,
    cleanupCutoff,
    runningChildWorkflows = [],
    runningSleeps = [],
    runningMessageWaits = [],
    runningEvents = [],
  } = inputs;
  const runState = createWorkflowRunStateSummaryReducer(now, cleanupCutoff);
  for (const run of runs) {
    runState.addRun(run);
  }
  const streams = createWorkflowRunStreamActivitySummaryReducer();
  const hooks = createWorkflowRunHookActivitySummaryReducer();
  for (const runEvents of runningEvents) {
    const activeEvents = activeWorkflowEvents(runEvents.events);
    for (const stream of activeEvents.streams) {
      streams.addStream(runEvents.runId, stream);
    }
    for (const hook of activeEvents.hooks) {
      hooks.addHook(runEvents.runId, hook);
    }
  }
  const sleeps = createWorkflowRunSleepWaitSummaryReducer();
  for (const runSleeps of runningSleeps) {
    sleeps.addAttempts(runSleeps.runId, runSleeps.attempts);
  }
  const messageWaits = createWorkflowRunMessageWaitSummaryReducer();
  for (const runWaits of runningMessageWaits) {
    messageWaits.addAttempts(runWaits.runId, runWaits.attempts);
  }
  const childWorkflowWaits = createWorkflowRunChildWorkflowWaitSummaryReducer();
  for (const childWorkflowWait of runningChildWorkflows) {
    childWorkflowWaits.addChildWorkflowAttempts(
      childWorkflowWait.runId,
      childWorkflowWait.attempts,
      childWorkflowWait.childRuns,
    );
  }

  return {
    ...runState.finish(),
    ...streams.finish(),
    ...hooks.finish(),
    ...sleeps.finish(),
    ...messageWaits.finish(),
    ...childWorkflowWaits.finish(),
  };
}
