import type { RunId } from "../../types/run.ts";
import type { StepId } from "../../types/step.ts";
import type { WorkflowRunHookSummary } from "../../types/summary.ts";
import type { ActiveWorkflowHookSummary } from "./active-events.ts";

import {
  earliestOptionalTimestamp,
  shouldReplaceWorkflowEarliestDefinedInstant,
} from "../../temporal.ts";

interface WorkflowRunHookActivitySummary {
  readonly hook?: WorkflowRunHookSummary;
}

interface WorkflowRunHookActivityAccumulator {
  hookTotal: number;
  nextTimeoutAt?: Temporal.Instant;
  nextTimeoutRunId?: RunId;
  nextTimeoutStepId?: StepId;
  oldestStartedAt?: Temporal.Instant;
  webhookTotal: number;
  readonly hookNames: Set<string>;
  readonly messages: Set<string>;
  readonly runIds: Set<string>;
  readonly stepIds: Set<string>;
  readonly webhookNames: Set<string>;
}

export interface WorkflowRunHookActivitySummaryReducer {
  readonly addHook: (runId: RunId, hook: ActiveWorkflowHookSummary) => void;
  readonly finish: () => WorkflowRunHookActivitySummary;
}

export function createWorkflowRunHookActivitySummaryReducer(): WorkflowRunHookActivitySummaryReducer {
  const hooks = createWorkflowRunHookActivityAccumulator();

  return {
    addHook(runId, hook) {
      addWorkflowRunHookActivity(hooks, runId, hook);
    },
    finish() {
      return finishWorkflowRunHookActivitySummary(hooks);
    },
  };
}

function createWorkflowRunHookActivityAccumulator(): WorkflowRunHookActivityAccumulator {
  return {
    hookTotal: 0,
    webhookTotal: 0,
    hookNames: new Set<string>(),
    messages: new Set<string>(),
    runIds: new Set<string>(),
    stepIds: new Set<string>(),
    webhookNames: new Set<string>(),
  };
}

function addWorkflowRunHookActivity(
  hooks: WorkflowRunHookActivityAccumulator,
  runId: RunId,
  hook: ActiveWorkflowHookSummary,
): void {
  if (hook.source === "hook") {
    hooks.hookTotal++;
    hooks.hookNames.add(hook.name);
  } else {
    hooks.webhookTotal++;
    hooks.webhookNames.add(hook.name);
  }

  hooks.runIds.add(runId);
  hooks.stepIds.add(hook.stepId);
  hooks.messages.add(hook.messageId);
  hooks.oldestStartedAt = earliestOptionalTimestamp(hooks.oldestStartedAt, hook.startedAt);

  if (shouldReplaceWorkflowEarliestDefinedInstant(hooks.nextTimeoutAt, hook.timeoutAt)) {
    setWorkflowRunHookNextTimeout(hooks, runId, hook);
  }
}

function setWorkflowRunHookNextTimeout(
  hooks: WorkflowRunHookActivityAccumulator,
  runId: RunId,
  hook: ActiveWorkflowHookSummary,
): void {
  hooks.nextTimeoutAt = hook.timeoutAt;
  hooks.nextTimeoutRunId = runId;
  hooks.nextTimeoutStepId = hook.stepId;
}

function finishWorkflowRunHookActivitySummary(
  hooks: WorkflowRunHookActivityAccumulator,
): WorkflowRunHookActivitySummary {
  if (hooks.hookTotal + hooks.webhookTotal === 0) {
    return {};
  }

  const result: NonNullable<WorkflowRunHookActivitySummary["hook"]> = {
    activeHooks: hooks.hookTotal,
    activeWebhooks: hooks.webhookTotal,
    activeHookRuns: hooks.runIds.size,
    hookRunIds: [...hooks.runIds].sort(),
    hookStepIds: [...hooks.stepIds].sort(),
    hookNames: [...hooks.hookNames].sort(),
    webhookNames: [...hooks.webhookNames].sort(),
    messages: [...hooks.messages].sort(),
  };

  if (hooks.oldestStartedAt !== undefined) {
    Object.assign(result, { oldestStartedAt: hooks.oldestStartedAt } satisfies Partial<
      NonNullable<WorkflowRunHookActivitySummary["hook"]>
    >);
  }

  if (hooks.nextTimeoutAt !== undefined) {
    Object.assign(result, { nextTimeoutAt: hooks.nextTimeoutAt } satisfies Partial<
      NonNullable<WorkflowRunHookActivitySummary["hook"]>
    >);

    if (!(hooks.nextTimeoutRunId === undefined)) {
      Object.assign(result, { nextTimeoutRunId: hooks.nextTimeoutRunId } satisfies Partial<
        NonNullable<WorkflowRunHookActivitySummary["hook"]>
      >);
    }

    if (!(hooks.nextTimeoutStepId === undefined)) {
      Object.assign(result, { nextTimeoutStepId: hooks.nextTimeoutStepId } satisfies Partial<
        NonNullable<WorkflowRunHookActivitySummary["hook"]>
      >);
    }
  }

  return { hook: result };
}
