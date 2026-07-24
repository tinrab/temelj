import type { WorkflowImplementation } from "../types/definition.ts";
import type { WorkflowRunStarter } from "../types/engine.ts";
import type { ExecutionResult, WorkflowHandle } from "../types/result.ts";
import type { WorkflowExecutionOptions, WorkflowResumeOptions } from "../types/run-options.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type {
  WorkflowConditionalEventAppender,
  WorkflowEventReader,
  WorkflowLockConditionalWriterRepository,
  WorkflowLockListerRepository,
  WorkflowRunReaderRepository,
  WorkflowRunWriterRepository,
  WorkflowStepAttemptLookup,
} from "../types/store.ts";

import { executeWorkflowRun, type WorkflowExecutionServiceOptions } from "./execution-service.ts";
import { makeCompletedRunResult, makeCanceledRunResult } from "./run-utils.ts";
import { failRunForDeadline, getRequiredRun, requireDefinitionMatchesRun } from "./state.ts";

export interface WorkflowEngineExecutionApi {
  runWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowExecutionOptions,
  ): Promise<WorkflowHandle<TOutput>>;
  runWorkflowNow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options?: WorkflowExecutionOptions,
  ): Promise<ExecutionResult<TOutput>>;
  resumeWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    runId: RunId,
    options?: WorkflowResumeOptions,
  ): Promise<ExecutionResult<TOutput>>;
}

type WorkflowEngineExecutionApiStore = WorkflowRunReaderRepository &
  WorkflowRunWriterRepository &
  WorkflowConditionalEventAppender &
  WorkflowEventReader &
  WorkflowStepAttemptLookup &
  WorkflowLockListerRepository &
  WorkflowLockConditionalWriterRepository;

interface WorkflowEngineExecutionResumer {
  resumeWorkflow<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
    runId: RunId,
    options?: WorkflowResumeOptions,
  ): Promise<ExecutionResult<TOutput>>;
}

interface WorkflowEngineExecutionApiOptions {
  readonly store: WorkflowEngineExecutionApiStore;
  readonly now: () => Temporal.Instant;
  readonly executionService: WorkflowExecutionServiceOptions;
  readonly emitResultLifecycleEvent: <TOutput>(
    result: ExecutionResult<TOutput>,
    previous?: WorkflowRunRecord,
  ) => Promise<ExecutionResult<TOutput>>;
  readonly starter: WorkflowRunStarter;
  readonly resumer: WorkflowEngineExecutionResumer;
}

export function createWorkflowEngineExecutionApi(
  service: WorkflowEngineExecutionApiOptions,
): WorkflowEngineExecutionApi {
  return {
    async runWorkflow<TInput, TOutput, TRawInput = TInput>(
      implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
      input: TRawInput,
      executionOptions?: WorkflowExecutionOptions,
    ) {
      return await service.starter.startWorkflow(
        implementation.definition,
        input,
        executionOptions?.start,
      );
    },

    async runWorkflowNow<TInput, TOutput, TRawInput = TInput>(
      implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
      input: TRawInput,
      executionOptions?: WorkflowExecutionOptions,
    ) {
      const handle = await service.starter.startWorkflow(
        implementation.definition,
        input,
        executionOptions?.start,
      );
      return await service.resumer.resumeWorkflow(implementation, handle.runId, {
        signal: executionOptions?.signal,
      });
    },

    async resumeWorkflow<TInput, TOutput, TRawInput = TInput>(
      implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
      runId: RunId,
      resumeOptions?: WorkflowResumeOptions,
    ): Promise<ExecutionResult<TOutput>> {
      const run = await getRequiredRun(service.store, runId);
      requireDefinitionMatchesRun(implementation.definition, run);

      if (run.status === "completed") {
        return makeCompletedRunResult<TOutput>(run);
      }

      if (run.status === "canceled") {
        return makeCanceledRunResult(run);
      }

      const timestamp = service.now();
      if (
        run.deadlineAt !== undefined &&
        Temporal.Instant.compare(run.deadlineAt, timestamp) <= 0
      ) {
        return await service.emitResultLifecycleEvent(
          await failRunForDeadline(service.store, run, run.deadlineAt, timestamp),
          run,
        );
      }

      const availableAt = run.availableAt;
      if (availableAt !== undefined && Temporal.Instant.compare(availableAt, timestamp) > 0) {
        return {
          kind: "waiting",
          run,
          availableAt,
        };
      }

      return await executeWorkflowRun(service.executionService, implementation, run, resumeOptions);
    },
  };
}
