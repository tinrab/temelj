import type { ExecutionEnvironment } from "../types/engine.ts";
import type {
  DeterministicApi,
  StepApi,
  WorkflowStepContext,
  StepRunConfig,
} from "../types/step.ts";
import type { WorkflowEngine } from "./create.ts";

import { createStepWorkflowApi } from "./child-workflow.ts";
import { createStepHookApi } from "./hooks.ts";
import { createStepLockApi } from "./lock.ts";
import { createStepMessageApi } from "./message.ts";
import { createRunDataApi } from "./run-data.ts";
import { createStepStreamApi } from "./stream.ts";
import { createStepTaskApi } from "./task.ts";

type RunTaskCommand = <TOutput>(
  config: StepRunConfig,
  callback: (context: WorkflowStepContext) => Promise<TOutput> | TOutput,
) => Promise<TOutput>;

export function createStepApi(
  environment: ExecutionEnvironment,
  engine: WorkflowEngine,
  executionSignal: AbortSignal,
  deterministic: DeterministicApi,
): StepApi {
  const task = createStepTaskApi(environment, executionSignal);

  const runTask: RunTaskCommand = (config, callback) => task.run(config, callback);

  return {
    log: environment.logger,
    ...task,
    workflow: createStepWorkflowApi(environment, engine),
    message: createStepMessageApi(environment),
    lock: createStepLockApi(environment, engine, runTask),
    runData: createRunDataApi(environment),
    deterministic,
    stream: createStepStreamApi(environment),
    hook: createStepHookApi(environment),
  };
}
