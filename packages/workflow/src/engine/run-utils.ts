import type { CleanupRunsOptions, RetentionPolicyOptions } from "../types/cleanup.ts";
import type { WorkflowDefinition } from "../types/definition.ts";
import type { RunId } from "../types/ids.ts";
import type { CompletedResult, ExecutionResult } from "../types/result.ts";
import type { RunRecord } from "../types/run.ts";
import type { WorkflowStore } from "../types/store.ts";

import { WorkflowRunCanceledError } from "../errors/mod.ts";
import { getRequiredRun } from "../store/query.ts";
import { serializeError } from "./serialization.ts";
import { requireDefinitionMatchesRun } from "./state.ts";

export function retentionCleanupOptions(
  options: RetentionPolicyOptions,
  engineNow: () => Temporal.Instant,
): CleanupRunsOptions {
  const now = options.now === undefined ? engineNow() : options.now;

  return {
    finishedAtBefore: now.toZonedDateTimeISO("UTC").subtract(options.olderThan).toInstant(),
    status: options.status,
    workflowName: options.workflowName,
    workflowVersion: options.workflowVersion,
    idempotencyKey: options.idempotencyKey,
    parentRunId: options.parentRunId,
    parentStepId: options.parentStepId,
    parentStepName: options.parentStepName,
    parentStepAttempt: options.parentStepAttempt,
    dryRun: options.dryRun,
    limit: options.limit,
  };
}

export async function readRunResult<TOutput>(
  store: WorkflowStore,
  definition: WorkflowDefinition<unknown, TOutput, unknown>,
  runId: RunId,
  fallbackAvailableAt: Temporal.Instant,
): Promise<ExecutionResult<TOutput>> {
  const run = await getRequiredRun(store, runId);

  return run.status === "completed"
    ? makeCompletedRunResult(definition, run)
    : unfinishedRunResult(run, fallbackAvailableAt);
}

/** The result of a run that has not completed: failed, canceled, or still waiting. */
export function unfinishedRunResult<TOutput>(
  run: RunRecord,
  fallbackAvailableAt: Temporal.Instant,
): ExecutionResult<TOutput> {
  if (run.status === "failed") {
    return {
      kind: "failed",
      run,
      error: run.error ?? { name: "WorkflowError", message: `Workflow run failed: ${run.id}` },
    };
  }

  if (run.status === "canceled") {
    return makeCanceledRunResult(run);
  }

  return { kind: "waiting", run, availableAt: run.availableAt ?? fallbackAvailableAt };
}

export function makeCompletedRunResult<TOutput>(
  definition: WorkflowDefinition<unknown, TOutput, unknown>,
  run: RunRecord,
): CompletedResult<TOutput> {
  requireDefinitionMatchesRun(definition, run);

  if (run.status !== "completed") {
    throw new TypeError("A completed workflow result requires a completed run");
  }

  // SAFETY: This completed record matches the workflow contract; completion persists only that handler's serialization-validated output.
  return {
    kind: "completed",
    run,
    output: run.output as TOutput,
  };
}

export function makeCanceledRunResult<TOutput>(run: RunRecord): ExecutionResult<TOutput> {
  return {
    kind: "failed",
    run,
    error: run.error ?? serializeError(new WorkflowRunCanceledError(run.id)),
  };
}
