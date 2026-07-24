import type { StorageValue } from "@temelj/storage";

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

type WorkflowRunLookup = WorkflowRunReaderRepository;

type WorkflowHandleStore = WorkflowRunLookup & WorkflowEventReader;

export function retentionCleanupOptions(
  options: RetentionPolicyOptions,
  engineNow: () => Temporal.Instant,
): CleanupRunsOptions {
  const now = options.now === undefined ? engineNow() : options.now;
  return {
    finishedAtBefore: now.toZonedDateTimeISO("UTC").subtract(options.olderThan).toInstant(),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.workflowName === undefined ? {} : { workflowName: options.workflowName }),
    ...(options.workflowVersion === undefined ? {} : { workflowVersion: options.workflowVersion }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
    ...(options.parentStepId === undefined ? {} : { parentStepId: options.parentStepId }),
    ...(options.parentStepName === undefined ? {} : { parentStepName: options.parentStepName }),
    ...(options.parentStepAttempt === undefined
      ? {}
      : { parentStepAttempt: options.parentStepAttempt }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  };
}

export function workflowHandle<TOutput>(
  store: WorkflowHandleStore,
  definition: WorkflowDefinition<unknown, TOutput>,
  runId: RunId,
  now: () => Temporal.Instant,
  operations: HandleOperations,
): WorkflowHandle<TOutput> {
  return {
    runId,
    workflowName: definition.name,
    ...(definition.version === undefined ? {} : { workflowVersion: definition.version }),
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
    result: async () => await readRunResult<TOutput>(store, runId, now()),
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
  runId: RunId,
  fallbackAvailableAt: Temporal.Instant,
): Promise<ExecutionResult<TOutput>> {
  const run = await getRequiredRun(store, runId);
  if (run.status === "completed") {
    return makeCompletedRunResult<TOutput>(run);
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

export function makeCompletedRunResult<TOutput>(run: WorkflowRunRecord): CompletedResult<TOutput> {
  return {
    kind: "completed",
    run: run as WorkflowRunRecord<StorageValue, TOutput>,
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
