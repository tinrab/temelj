import type { WorkflowExecutionEnvironment } from "../types/engine.ts";
import type {
  WorkflowDeterministicApi,
  WorkflowStepApi,
  WorkflowStepContext,
  WorkflowStepRunConfig,
} from "../types/step.ts";

import {
  createWorkflowStepWorkflowApi,
  type WorkflowChildWorkflowEngine,
} from "./child-workflow.ts";
import { createWorkflowStepHookApi } from "./hooks.ts";
import { createWorkflowStepLockApi, type WorkflowStepLockEngine } from "./lock.ts";
import { createWorkflowStepMessageApi } from "./message.ts";
import { createWorkflowRunDataApi } from "./run-data.ts";
import { createWorkflowStepStreamApi } from "./stream.ts";
import { createWorkflowStepTaskApi } from "./task.ts";

type WorkflowStepRuntime = WorkflowChildWorkflowEngine & WorkflowStepLockEngine;
type WorkflowRunTaskCommand = <TOutput>(
  config: WorkflowStepRunConfig,
  callback: (context: WorkflowStepContext) => Promise<TOutput> | TOutput,
) => Promise<TOutput>;

export function createStepApi(
  environment: WorkflowExecutionEnvironment,
  engine: WorkflowStepRuntime,
  executionSignal: AbortSignal,
  deterministic: WorkflowDeterministicApi,
): WorkflowStepApi {
  const task = createWorkflowStepTaskApi(environment, executionSignal);
  const runTask: WorkflowRunTaskCommand = async (config, callback) =>
    await task.run(config, callback);
  return {
    log: environment.logger,
    task,
    workflow: createWorkflowStepWorkflowApi(environment, engine),
    message: createWorkflowStepMessageApi(environment),
    lock: createWorkflowStepLockApi(environment, engine, runTask),
    runData: createWorkflowRunDataApi(environment),
    deterministic,
    stream: createWorkflowStepStreamApi(environment),
    hook: createWorkflowStepHookApi(environment),
  };
}
