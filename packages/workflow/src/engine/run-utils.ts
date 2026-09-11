import type { CleanupRunsOptions, RetentionPolicyOptions } from "../types/cleanup.ts";
import type { WorkflowDefinition } from "../types/definition.ts";
import type {
  CompletedResult,
  ExecutionResult,
  WorkflowHandle,
  HandleOperations,
} from "../types/result.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowEventReader, WorkflowRunReaderRepository } from "../types/store.ts";

import { WorkflowRunCanceledError } from "../errors/mod.ts";
import { getRequiredRun } from "../utility.ts";
import { serializeError } from "./serialization.ts";
import { requireDefinitionMatchesRun } from "./state.ts";

type WorkflowRunLookup = WorkflowRunReaderRepository;

type WorkflowHandleStore = WorkflowRunLookup & WorkflowEventReader;

export function retentionCleanupOptions(
  options: RetentionPolicyOptions,
  engineNow: () => Temporal.Instant,
): CleanupRunsOptions {
  const now = options.now === undefined ? engineNow() : options.now;

  const summary: CleanupRunsOptions = {
    finishedAtBefore: now.toZonedDateTimeISO("UTC").subtract(options.olderThan).toInstant(),
  };

  if (options.status !== undefined) {
    Object.assign(summary, { status: options.status } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.workflowName !== undefined) {
    Object.assign(summary, {
      workflowName: options.workflowName,
    } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.workflowVersion !== undefined) {
    Object.assign(summary, {
      workflowVersion: options.workflowVersion,
    } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.idempotencyKey !== undefined) {
    Object.assign(summary, {
      idempotencyKey: options.idempotencyKey,
    } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.parentRunId !== undefined) {
    Object.assign(summary, {
      parentRunId: options.parentRunId,
    } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.parentStepId !== undefined) {
    Object.assign(summary, {
      parentStepId: options.parentStepId,
    } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.parentStepName !== undefined) {
    Object.assign(summary, {
      parentStepName: options.parentStepName,
    } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.parentStepAttempt !== undefined) {
    Object.assign(summary, {
      parentStepAttempt: options.parentStepAttempt,
    } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.dryRun !== undefined) {
    Object.assign(summary, { dryRun: options.dryRun } satisfies Partial<CleanupRunsOptions>);
  }

  if (options.limit !== undefined) {
    Object.assign(summary, { limit: options.limit } satisfies Partial<CleanupRunsOptions>);
  }

  return summary;
}

export function workflowHandle<TOutput>(
  store: WorkflowHandleStore,
  definition: WorkflowDefinition<unknown, TOutput>,
  runId: RunId,
  now: () => Temporal.Instant,
  operations: HandleOperations,
): WorkflowHandle<TOutput> {
  const identity = { runId: runId, workflowName: definition.name } satisfies Partial<
    WorkflowHandle<TOutput>
  >;

  if (definition.version !== undefined) {
    Object.assign(identity, { workflowVersion: definition.version } satisfies Partial<
      WorkflowHandle<TOutput>
    >);
  }

  return {
    ...identity,
    async getRun() {
      return await getRequiredRun(store, runId);
    },
    async status() {
      const run = await getRequiredRun(store, runId);

      return run.status;
    },
    async events() {
      return await store.getEvents(runId);
    },
    async timeline() {
      return await operations.getTimeline(runId);
    },
    result: async () => await readRunResult(store, definition, runId, now()),
    async setMetadata(metadata) {
      return await operations.setMetadata(runId, metadata);
    },
    async setAttributes(attributes) {
      return await operations.setAttributes(runId, attributes);
    },
    async cancel() {
      return await operations.cancel(runId);
    },
  };
}

export async function readRunResult<TOutput>(
  store: WorkflowRunLookup,
  definition: WorkflowDefinition<unknown, TOutput, unknown>,
  runId: RunId,
  fallbackAvailableAt: Temporal.Instant,
): Promise<ExecutionResult<TOutput>> {
  const run = await getRequiredRun(store, runId);

  if (run.status === "completed") {
    return makeCompletedRunResult(definition, run);
  }

  if (run.status === "failed") {
    return {
      kind: "failed",
      run,
      error: run.error ?? {
        name: "WorkflowError",
        message: `Workflow run failed: ${runId}`,
      },
    };
  }

  if (run.status === "canceled") {
    return makeCanceledRunResult(run);
  }

  return {
    kind: "waiting",
    run,
    availableAt: run.availableAt ?? fallbackAvailableAt,
  };
}

export function makeCompletedRunResult<TOutput>(
  definition: WorkflowDefinition<unknown, TOutput, unknown>,
  run: WorkflowRunRecord,
): CompletedResult<TOutput> {
  requireDefinitionMatchesRun(definition, run);

  if (run.status !== "completed") {
    throw new TypeError("A completed workflow result requires a completed run");
  }

  // SAFETY: This completed record matches the workflow contract; completion persists only that handler's serialization-validated output.
  return {
    kind: "completed",
    run: run,
    output: run.output as TOutput,
  };
}

export function makeCanceledRunResult<TOutput>(run: WorkflowRunRecord): ExecutionResult<TOutput> {
  return {
    kind: "failed",
    run,
    error: run.error ?? serializeError(WorkflowRunCanceledError.create(run.id)),
  };
}
