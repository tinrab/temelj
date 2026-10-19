import type { StorageValue } from "@temelj/storage";

import type { WorkflowDefinition, StartTarget } from "../types/definition.ts";
import type { RunId } from "../types/ids.ts";
import type {
  ResolvedScheduleNextOptions,
  ScheduleNextOptions,
  StartOptions,
} from "../types/run-options.ts";
import type { RunRecord } from "../types/run.ts";
import type { IdempotencyKeyOptions } from "../types/store.ts";
import type { WorkflowEngine } from "./create.ts";

import { defineFromName, defineFromTarget } from "../definition.ts";
import { getRequiredRun } from "../store/query.ts";
import { captureTelemetryContext } from "../telemetry.ts";
import { resolveStartSpec } from "./run-service.ts";
import { enforceStorageValueSize, parseInput, toPersistedValue } from "./serialization.ts";

/** Resolves schedule-next options and derives the start time for the next run. */
export function resolveScheduleNextOptions(
  options: ScheduleNextOptions,
  now: () => Temporal.Instant,
): ResolvedScheduleNextOptions {
  const from = options.from ?? now();

  const start: StartOptions = {
    id: options.id,
    idempotencyKey: options.idempotencyKey,
    workflowVersion: options.workflowVersion,
    workflowVersionResolver: options.workflowVersionResolver,
    context: options.context,
    parent: options.parent,
    availableAt: from.toZonedDateTimeISO("UTC").add(options.every).toInstant(),
    deadlineAt: options.deadlineAt,
  };

  return {
    schedule: {
      ...options,
      from,
    },
    start,
  };
}

/** A started or existing run, with the definition that types its output. Internal. */
export interface RunRef<TOutput> {
  readonly runId: RunId;
  readonly definition: WorkflowDefinition<unknown, TOutput, unknown>;
}

/** An existing run; its output is the stored value, since a run ID carries no type. */
export async function getRunRef(
  engine: WorkflowEngine,
  runId: RunId,
): Promise<RunRef<StorageValue | undefined>> {
  const run = await getRequiredRun(engine.store, runId);

  return {
    runId,
    definition: defineFromName<unknown, StorageValue | undefined>(
      run.workflowName,
      run.workflowVersion,
    ),
  };
}

/** Creates a pending run, or returns the run that already holds the idempotency key. */
export async function startRun<TInput, TOutput, TRawInput = TInput>(
  engine: WorkflowEngine,
  workflow: StartTarget<TInput, TOutput, TRawInput>,
  input: TRawInput,
  startOptions?: StartOptions,
): Promise<RunRef<TOutput>> {
  const context = engine.context;
  const definition = await resolveStartSpec(defineFromTarget(workflow), startOptions);
  const persistedInput = await parseInput(definition, input);
  const idempotencyKey = startOptions?.idempotencyKey;

  if (idempotencyKey !== undefined) {
    const keyOptions: IdempotencyKeyOptions = {
      workflowName: definition.name,
      idempotencyKey,
      workflowVersion: definition.version,
    };

    const existingRun = await context.store.getRunByIdempotencyKey(keyOptions);

    if (existingRun !== undefined) {
      return { runId: existingRun.id, definition };
    }
  }

  const runId = startOptions?.id ?? context.createRunId();
  const timestamp = context.now();
  const parent = startOptions?.parent;

  enforceStorageValueSize(persistedInput, "workflow input", context.limits);

  const run: RunRecord = {
    id: runId,
    namespace: context.store.namespace,
    workflowName: definition.name,
    workflowVersion: definition.version,
    status: "pending",
    input: persistedInput,
    context:
      startOptions?.context === undefined
        ? undefined
        : toPersistedValue(startOptions.context, "workflow context", context.limits),
    telemetryContext: captureTelemetryContext(context.telemetry),
    attempts: 0,
    idempotencyKey,
    parentRunId: parent?.runId,
    parentStepId: parent?.stepId,
    parentStepName: parent?.stepName,
    parentStepAttempt: parent?.stepAttempt,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason: "created",
    availableAt: startOptions?.availableAt,
    deadlineAt: startOptions?.deadlineAt,
  };

  const createdRun = await context.store.createRun(run);
  context.observation.emitRunEvent(createdRun);

  return { runId: createdRun.id, definition };
}
