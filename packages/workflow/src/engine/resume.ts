import type { WorkflowImplementation } from "../types/definition.ts";
import type { RunId } from "../types/ids.ts";
import type { ExecutionResult } from "../types/result.ts";
import type { ResumeOptions } from "../types/run-options.ts";
import type { RunRecord } from "../types/run.ts";
import type { EngineContext } from "./context.ts";

import { getRequiredRun } from "../store/query.ts";
import { executeRun, type ExecutionServiceOptions } from "./execution-service.ts";
import { makeCompletedRunResult, makeCanceledRunResult } from "./run-utils.ts";
import { failRunForDeadline, requireDefinitionMatchesRun } from "./state.ts";

export interface ResumeRunServices {
  readonly context: EngineContext;
  readonly executionService: ExecutionServiceOptions;
  readonly emitResultLifecycleEvent: <TOutput>(
    result: ExecutionResult<TOutput>,
    previous?: RunRecord,
  ) => Promise<ExecutionResult<TOutput>>;
}

/** Runs a stored run until it finishes or waits, unless it is done, past its deadline, or not due. */
export async function resumeRun<TInput, TOutput, TRawInput = TInput>(
  services: ResumeRunServices,
  implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  runId: RunId,
  resumeOptions?: ResumeOptions,
): Promise<ExecutionResult<TOutput>> {
  const { context } = services;
  const run = await getRequiredRun(context.store, runId);
  requireDefinitionMatchesRun(implementation.definition, run);

  if (run.status === "completed") {
    return makeCompletedRunResult(implementation.definition, run);
  }

  if (run.status === "canceled") {
    return makeCanceledRunResult(run);
  }

  const timestamp = context.now();

  if (run.deadlineAt !== undefined && Temporal.Instant.compare(run.deadlineAt, timestamp) <= 0) {
    return await services.emitResultLifecycleEvent(
      await failRunForDeadline(
        context.store,
        implementation.definition,
        run,
        run.deadlineAt,
        timestamp,
      ),
      run,
    );
  }

  const availableAt = run.availableAt;

  if (availableAt !== undefined && Temporal.Instant.compare(availableAt, timestamp) > 0) {
    return { kind: "waiting", run, availableAt };
  }

  return await executeRun(services.executionService, implementation, run, resumeOptions);
}
