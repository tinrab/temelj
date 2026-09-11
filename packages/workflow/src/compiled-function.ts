import type {
  CompiledWorkflowFunction,
  WorkflowClient,
  WorkflowRunHandle,
} from "./types/client.ts";
import type { WorkflowImplementation, RegistryLike } from "./types/definition.ts";
import type { WorkflowStepApi, WorkflowStepDefinition } from "./types/step.ts";

import { COMPILED_WORKFLOW, COMPILED_STEP } from "./compiled-symbols.ts";
import { WorkflowDefinitionError } from "./errors/mod.ts";

type AnyCompiledWorkflowImplementation = WorkflowImplementation<
  readonly unknown[],
  unknown,
  readonly unknown[]
>;

/** Attaches compiled workflow metadata to a directive-authored function. */
export function attachWorkflowDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
  definition: WorkflowImplementation<NoInfer<TArgs>, Awaited<NoInfer<TOutput>>, NoInfer<TArgs>>,
): CompiledWorkflowFunction<TArgs, TOutput> {
  Object.defineProperty(fn, COMPILED_WORKFLOW, {
    value: definition,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  return fn;
}

/** Attaches compiled step metadata to a directive-authored function. */
export function attachWorkflowStepDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
  definition: WorkflowStepDefinition<NoInfer<TArgs>, Awaited<NoInfer<TOutput>>>,
): CompiledWorkflowFunction<TArgs, TOutput> {
  Object.defineProperty(fn, COMPILED_STEP, {
    value: definition,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  return fn;
}

/** Reads workflow metadata previously attached to a compiled workflow function. */
export function getWorkflowFunctionDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
): WorkflowImplementation<TArgs, Awaited<TOutput>, TArgs> | undefined {
  return fn[COMPILED_WORKFLOW];
}

/** Reads step metadata previously attached to a compiled step function. */
export function getWorkflowStepFunctionDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
): WorkflowStepDefinition<TArgs, Awaited<TOutput>> | undefined {
  return fn[COMPILED_STEP];
}

/** Reads compiler-owned metadata for heterogeneous workflow registration. */
export function getCompiledWorkflowDefinition(
  fn: Function,
): AnyCompiledWorkflowImplementation | undefined {
  // SAFETY: Only attachWorkflowDefinition writes this private, immutable symbol property.
  // This registry view erases the tuple type; execution uses the matching definition's persisted input.
  return Object.getOwnPropertyDescriptor(fn, COMPILED_WORKFLOW)?.value as
    | AnyCompiledWorkflowImplementation
    | undefined;
}

/** Registers compiled workflow functions with a workflow registry. */
export function registerWorkflowFunctions(
  registry: RegistryLike,
  workflows: readonly Function[],
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
