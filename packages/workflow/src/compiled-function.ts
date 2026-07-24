import type {
  CompiledWorkflowFunction,
  WorkflowClient,
  WorkflowRunHandle,
} from "./types/client.ts";
import type { WorkflowImplementation, RegistryLike } from "./types/definition.ts";
import type { WorkflowStepApi, WorkflowStepDefinition } from "./types/step.ts";

import { WorkflowDefinitionError } from "./errors/mod.ts";

type AnyCompiledWorkflowFunction = (...args: never[]) => unknown;
type AnyCompiledWorkflowImplementation = WorkflowImplementation<
  readonly unknown[],
  unknown,
  readonly unknown[]
>;
type AnyCompiledWorkflowStepDefinition = WorkflowStepDefinition<readonly unknown[], unknown>;

const workflowDefinitions = new WeakMap<
  AnyCompiledWorkflowFunction,
  AnyCompiledWorkflowImplementation
>();
const stepDefinitions = new WeakMap<
  AnyCompiledWorkflowFunction,
  AnyCompiledWorkflowStepDefinition
>();

/** Attaches compiled workflow metadata to a directive-authored function. */
export function attachWorkflowDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
  definition: WorkflowImplementation<TArgs, Awaited<TOutput>, TArgs>,
): CompiledWorkflowFunction<TArgs, TOutput> {
  workflowDefinitions.set(fn, definition as unknown as AnyCompiledWorkflowImplementation);
  return fn as CompiledWorkflowFunction<TArgs, TOutput>;
}

/** Attaches compiled step metadata to a directive-authored function. */
export function attachWorkflowStepDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
  definition: WorkflowStepDefinition<TArgs, Awaited<TOutput>>,
): CompiledWorkflowFunction<TArgs, TOutput> {
  stepDefinitions.set(fn, definition as unknown as AnyCompiledWorkflowStepDefinition);
  return fn as CompiledWorkflowFunction<TArgs, TOutput>;
}

/** Reads workflow metadata previously attached to a compiled workflow function. */
export function getWorkflowFunctionDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
): WorkflowImplementation<TArgs, Awaited<TOutput>, TArgs> | undefined {
  return getCompiledWorkflowDefinition(fn) as
    | WorkflowImplementation<TArgs, Awaited<TOutput>, TArgs>
    | undefined;
}

/** Reads step metadata previously attached to a compiled step function. */
export function getWorkflowStepFunctionDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
): WorkflowStepDefinition<TArgs, Awaited<TOutput>> | undefined {
  return getCompiledWorkflowStepDefinition(fn) as
    | WorkflowStepDefinition<TArgs, Awaited<TOutput>>
    | undefined;
}

/** Reads erased workflow metadata from a function after runtime validation. */
export function getCompiledWorkflowDefinition(
  fn: AnyCompiledWorkflowFunction,
): AnyCompiledWorkflowImplementation | undefined {
  return workflowDefinitions.get(fn);
}

/** Reads erased step metadata from a function after runtime validation. */
export function getCompiledWorkflowStepDefinition(
  fn: AnyCompiledWorkflowFunction,
): AnyCompiledWorkflowStepDefinition | undefined {
  return stepDefinitions.get(fn);
}

/** Registers compiled workflow functions with a workflow registry. */
export function registerWorkflowFunctions(
  registry: RegistryLike,
  workflows: readonly AnyCompiledWorkflowFunction[],
): void {
  for (const workflow of workflows) {
    const definition = getCompiledWorkflowDefinition(workflow);
    if (definition === undefined) {
      WorkflowDefinitionError.compiledMetadataMissing();
    }
    registry.register(definition);
  }
}

/** Starts a compiled workflow function through a workflow client. */
export async function runWorkflowFunction<TArgs extends readonly unknown[], TOutput>(
  client: WorkflowClient,
  workflow: CompiledWorkflowFunction<TArgs, TOutput>,
  ...args: TArgs
): Promise<WorkflowRunHandle<Awaited<TOutput>>> {
  const definition = getWorkflowFunctionDefinition(workflow);
  if (definition === undefined) {
    WorkflowDefinitionError.compiledMetadataMissing();
  }
  client.register(definition);
  return await client.runs.start(definition.definition, args);
}

/** Calls a compiled step function through the durable step API when metadata is present. */
export async function callWorkflowStepFunction<TArgs extends readonly unknown[], TOutput>(
  step: WorkflowStepApi,
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
  ...args: TArgs
): Promise<Awaited<TOutput>> {
  const definition = getWorkflowStepFunctionDefinition(fn);
  if (definition === undefined) {
    return await fn(...args);
  }
  return await step.task.call(definition, ...args);
}
