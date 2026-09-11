import type { WorkflowDefinition, WorkflowStartTarget } from "../types/definition.ts";
import type { WorkflowExecutionLimits } from "../types/engine-options.ts";
import type { WorkflowRunStarter } from "../types/engine.ts";
import type { WorkflowHandle, HandleOperations } from "../types/result.ts";
import type {
  WorkflowBatchStartItem,
  ResolvedScheduleNextOptions,
  ScheduleNextOptions,
  WorkflowStartOptions,
} from "../types/run-options.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type {
  WorkflowEventReader,
  WorkflowIdempotencyIndex,
  WorkflowIdempotencyKeyOptions,
  WorkflowRunCreationRepository,
  WorkflowRunReaderRepository,
  WorkflowStoreNamespace,
} from "../types/store.ts";
import type { Telemetry } from "../types/telemetry.ts";

import { defineWorkflowFromTarget } from "../definition.ts";
import { captureTelemetryContext } from "../telemetry.ts";
import { resolveWorkflowStartSpec } from "./run-service.ts";
import { workflowHandle } from "./run-utils.ts";
import { enforceStorageValueSize, parseWorkflowInput, toPersistedValue } from "./serialization.ts";

export interface WorkflowEngineStartApi {
  startWorkflow<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowHandle<TOutput>>;
  startWorkflows<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    items: readonly WorkflowBatchStartItem<TRawInput>[],
  ): Promise<readonly WorkflowHandle<TOutput>[]>;
  scheduleNextWorkflow<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options: ScheduleNextOptions,
  ): Promise<WorkflowHandle<TOutput>>;
}

/** Resolves schedule-next options and derives the start time for the next run. */
export function resolveScheduleNextOptions(
  options: ScheduleNextOptions,
  now: () => Temporal.Instant,
): ResolvedScheduleNextOptions {
  const from = options.from ?? now();

  const result = {} satisfies Partial<WorkflowStartOptions>;

  if (options.id !== undefined) {
    Object.assign(result, { id: options.id } satisfies Partial<WorkflowStartOptions>);
  }

  const result1 = Object.assign(result, {
    idempotencyKey: options.idempotencyKey,
  } satisfies Partial<WorkflowStartOptions>);

  if (options.workflowVersion !== undefined) {
    Object.assign(result1, {
      workflowVersion: options.workflowVersion,
    } satisfies Partial<WorkflowStartOptions>);
  }

  if (options.workflowVersionResolver !== undefined) {
    Object.assign(result1, {
      workflowVersionResolver: options.workflowVersionResolver,
    } satisfies Partial<WorkflowStartOptions>);
  }

  if (options.context !== undefined) {
    Object.assign(result1, { context: options.context } satisfies Partial<WorkflowStartOptions>);
  }

  if (options.parent !== undefined) {
    Object.assign(result1, { parent: options.parent } satisfies Partial<WorkflowStartOptions>);
  }

  const result2 = Object.assign(result1, {
    availableAt: from.toZonedDateTimeISO("UTC").add(options.every).toInstant(),
  } satisfies Partial<WorkflowStartOptions>);

  if (options.deadlineAt !== undefined) {
    Object.assign(result2, {
      deadlineAt: options.deadlineAt,
    } satisfies Partial<WorkflowStartOptions>);
  }

  const start: WorkflowStartOptions = result2;

  return {
    schedule: {
      ...options,
      from,
    },
    start,
  };
}

type WorkflowEngineStartStore = WorkflowStoreNamespace &
  WorkflowRunCreationRepository &
  WorkflowRunReaderRepository &
  WorkflowIdempotencyIndex &
  WorkflowEventReader;

interface WorkflowEngineStartApiOptions {
  readonly store: WorkflowEngineStartStore;
  readonly now: () => Temporal.Instant;
  readonly limits: WorkflowExecutionLimits;
  readonly createRunId: () => string;
  readonly telemetry?: Telemetry;
  readonly emitRunEvent: (run: WorkflowRunRecord) => void;
  readonly starter: WorkflowRunStarter;
  readonly handleOperations: HandleOperations;
}

export function createWorkflowEngineStartApi(
  service: WorkflowEngineStartApiOptions,
): WorkflowEngineStartApi {
  return {
    async startWorkflow<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
      input: TRawInput,
      startOptions?: WorkflowStartOptions,
    ): Promise<WorkflowHandle<TOutput>> {
      const definition = defineWorkflowFromTarget(workflow);
      const resolvedDefinition = await resolveWorkflowStartSpec(definition, startOptions);
      const persistedInput = await parseWorkflowInput(resolvedDefinition, input);
      const idempotencyKey = startOptions?.idempotencyKey;
      const explicitRunId = startOptions?.id;

      if (idempotencyKey !== undefined) {
        const keyOptions: WorkflowIdempotencyKeyOptions = {
          workflowName: resolvedDefinition.name,
          idempotencyKey,
        };

        if (resolvedDefinition.version !== undefined) {
          Object.assign(keyOptions, {
            workflowVersion: resolvedDefinition.version,
          } satisfies Partial<WorkflowIdempotencyKeyOptions>);
        }

        const existingRun = await service.store.getRunByIdempotencyKey(keyOptions);

        if (existingRun !== undefined) {
          return workflowStartHandle(service, resolvedDefinition, existingRun.id);
        }
      }

      const runId = explicitRunId ?? service.createRunId();
      const timestamp = service.now();
      const availableAt = startOptions?.availableAt;
      const deadlineAt = startOptions?.deadlineAt;
      const parent = startOptions?.parent === undefined ? undefined : startOptions.parent;

      enforceStorageValueSize(persistedInput, "workflow input", service.limits);

      const persistedContext =
        startOptions?.context === undefined
          ? undefined
          : toPersistedValue(startOptions.context, "workflow context", service.limits);

      const telemetryContext = captureTelemetryContext(service.telemetry);

      const result = {
        id: runId,
        namespace: service.store.namespace,
        workflowName: resolvedDefinition.name,
      } satisfies Partial<WorkflowRunRecord>;

      if (resolvedDefinition.version !== undefined) {
        Object.assign(result, {
          workflowVersion: resolvedDefinition.version,
        } satisfies Partial<WorkflowRunRecord>);
      }

      const result1 = Object.assign(result, {
        status: "pending",
      } satisfies Partial<WorkflowRunRecord>);

      if (persistedInput !== undefined) {
        Object.assign(result1, { input: persistedInput } satisfies Partial<WorkflowRunRecord>);
      }

      if (persistedContext !== undefined) {
        Object.assign(result1, { context: persistedContext } satisfies Partial<WorkflowRunRecord>);
      }

      if (telemetryContext !== undefined) {
        Object.assign(result1, { telemetryContext } satisfies Partial<WorkflowRunRecord>);
      }

      const result2 = Object.assign(result1, { attempts: 0 } satisfies Partial<WorkflowRunRecord>);

      if (idempotencyKey !== undefined) {
        Object.assign(result2, { idempotencyKey } satisfies Partial<WorkflowRunRecord>);
      }

      if (parent !== undefined) {
        Object.assign(result2, { parentRunId: parent.runId } satisfies Partial<WorkflowRunRecord>);

        if (!(parent.stepId === undefined)) {
          Object.assign(result2, {
            parentStepId: parent.stepId,
          } satisfies Partial<WorkflowRunRecord>);
        }

        if (!(parent.stepName === undefined)) {
          Object.assign(result2, {
            parentStepName: parent.stepName,
          } satisfies Partial<WorkflowRunRecord>);
        }

        if (!(parent.stepAttempt === undefined)) {
          Object.assign(result2, {
            parentStepAttempt: parent.stepAttempt,
          } satisfies Partial<WorkflowRunRecord>);
        }
      }

      const result3 = Object.assign(result2, {
        createdAt: timestamp,
        updatedAt: timestamp,
        lastTransitionAt: timestamp,
        lastTransitionReason: "created",
      } satisfies Partial<WorkflowRunRecord>);

      if (availableAt !== undefined) {
        Object.assign(result3, { availableAt } satisfies Partial<WorkflowRunRecord>);
      }

      if (deadlineAt !== undefined) {
        Object.assign(result3, { deadlineAt } satisfies Partial<WorkflowRunRecord>);
      }

      const run: WorkflowRunRecord = result3;

      const createdRun = await service.store.createRun(run);
      service.emitRunEvent(createdRun);

      return workflowStartHandle(service, resolvedDefinition, createdRun.id);
    },

    async startWorkflows<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
      items: readonly WorkflowBatchStartItem<TRawInput>[],
    ): Promise<readonly WorkflowHandle<TOutput>[]> {
      const handles: Array<WorkflowHandle<TOutput>> = [];

      for (const item of items) {
        handles.push(await service.starter.startWorkflow(workflow, item.input, item.options));
      }

      return handles;
    },

    async scheduleNextWorkflow<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
      input: TRawInput,
      scheduleOptions: ScheduleNextOptions,
    ): Promise<WorkflowHandle<TOutput>> {
      const options = resolveScheduleNextOptions(scheduleOptions, service.now).start;

      return await service.starter.startWorkflow(workflow, input, options);
    },
  };
}

function workflowStartHandle<TInput, TOutput, TRawInput>(
  service: WorkflowEngineStartApiOptions,
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  runId: RunId,
): WorkflowHandle<TOutput> {
  return workflowHandle<TOutput>(service.store, definition, runId, service.now, {
    getTimeline: async (currentRunId) => await service.handleOperations.getTimeline(currentRunId),
    setMetadata: async (currentRunId, metadata) =>
      await service.handleOperations.setMetadata(currentRunId, metadata),
    setAttributes: async (currentRunId, attributes) =>
      await service.handleOperations.setAttributes(currentRunId, attributes),
    cancel: async (currentRunId) => await service.handleOperations.cancel(currentRunId),
  });
}
