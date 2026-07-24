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
  WorkflowRunCreationRepository,
  WorkflowRunReaderRepository,
  WorkflowStoreNamespace,
} from "../types/store.ts";
import type { Telemetry } from "../types/telemetry.ts";

import { parseWorkflowInput, defineWorkflowFromTarget } from "../definition.ts";
import { captureTelemetryContext } from "../telemetry.ts";
import { resolveWorkflowStartSpec } from "./run-service.ts";
import { workflowHandle } from "./run-utils.ts";
import { toOptionalPersistedValue, toPersistedValue } from "./serialization.ts";

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
  const start: WorkflowStartOptions = {
    ...(options.id === undefined ? {} : { id: options.id }),
    idempotencyKey: options.idempotencyKey,
    ...(options.workflowVersion === undefined ? {} : { workflowVersion: options.workflowVersion }),
    ...(options.workflowVersionResolver === undefined
      ? {}
      : { workflowVersionResolver: options.workflowVersionResolver }),
    ...(options.context === undefined ? {} : { context: options.context }),
    ...(options.parent === undefined ? {} : { parent: options.parent }),
    availableAt: from.toZonedDateTimeISO("UTC").add(options.every).toInstant(),
    ...(options.deadlineAt === undefined ? {} : { deadlineAt: options.deadlineAt }),
  };
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
      const parsedInput = await parseWorkflowInput(resolvedDefinition, input);
      const idempotencyKey = startOptions?.idempotencyKey;
      const explicitRunId = startOptions?.id;
      const existingRun =
        idempotencyKey === undefined
          ? undefined
          : await service.store.getRunByIdempotencyKey({
              workflowName: resolvedDefinition.name,
              ...(resolvedDefinition.version === undefined
                ? {}
                : { workflowVersion: resolvedDefinition.version }),
              idempotencyKey,
            });
      if (existingRun !== undefined) {
        return workflowStartHandle(service, resolvedDefinition, existingRun.id);
      }

      const runId = explicitRunId ?? service.createRunId();
      const timestamp = service.now();
      const availableAt = startOptions?.availableAt;
      const deadlineAt = startOptions?.deadlineAt;
      const parent = startOptions?.parent === undefined ? undefined : startOptions.parent;
      const persistedInput = toOptionalPersistedValue(
        parsedInput,
        "workflow input",
        service.limits,
      );

      const run: WorkflowRunRecord = {
        id: runId,
        namespace: service.store.namespace,
        workflowName: resolvedDefinition.name,
        ...(resolvedDefinition.version === undefined
          ? {}
          : { workflowVersion: resolvedDefinition.version }),
        status: "pending",
        ...(persistedInput === undefined ? {} : { input: persistedInput }),
        ...(startOptions?.context === undefined
          ? {}
          : {
              context: toPersistedValue(startOptions.context, "workflow context", service.limits),
            }),
        ...(() => {
          const telemetryContext = captureTelemetryContext(service.telemetry);
          return telemetryContext === undefined ? {} : { telemetryContext };
        })(),
        attempts: 0,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        ...(parent === undefined
          ? {}
          : {
              parentRunId: parent.runId,
              ...(parent.stepId === undefined ? {} : { parentStepId: parent.stepId }),
              ...(parent.stepName === undefined ? {} : { parentStepName: parent.stepName }),
              ...(parent.stepAttempt === undefined
                ? {}
                : { parentStepAttempt: parent.stepAttempt }),
            }),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastTransitionAt: timestamp,
        lastTransitionReason: "created",
        ...(availableAt === undefined ? {} : { availableAt }),
        ...(deadlineAt === undefined ? {} : { deadlineAt }),
      };

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
