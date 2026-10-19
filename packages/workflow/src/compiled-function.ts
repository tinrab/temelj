import type { CompiledWorkflowFunction } from "./types/client.ts";
import type { WorkflowImplementation, RegistryLike } from "./types/definition.ts";
import type { StepApi, StepDefinition } from "./types/step.ts";

import { WorkflowDefinitionError } from "./errors/mod.ts";

export const COMPILED_WORKFLOW = Symbol("temelj.workflow.definition");

export const COMPILED_STEP = Symbol("temelj.workflow.step");

type AnyCompiledImplementation = WorkflowImplementation<
  readonly unknown[],
  unknown,
  readonly unknown[]
>;

/** Attaches compiled workflow metadata to a directive-authored function. */
export function attachWorkflowDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
  definition: WorkflowImplementation<NoInfer<TArgs>, Awaited<NoInfer<TOutput>>, NoInfer<TArgs>>,
): CompiledWorkflowFunction<TArgs, TOutput> {
  // Non-writable, non-configurable and non-enumerable by default.
  Object.defineProperty(fn, COMPILED_WORKFLOW, { value: definition });

  return fn;
}

/** Attaches compiled step metadata to a directive-authored function. */
export function attachWorkflowStepDefinition<TArgs extends readonly unknown[], TOutput>(
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
  definition: StepDefinition<NoInfer<TArgs>, Awaited<NoInfer<TOutput>>>,
): CompiledWorkflowFunction<TArgs, TOutput> {
  // Non-writable, non-configurable and non-enumerable by default.
  Object.defineProperty(fn, COMPILED_STEP, { value: definition });

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
): StepDefinition<TArgs, Awaited<TOutput>> | undefined {
  return fn[COMPILED_STEP];
}

/** Reads compiler-owned metadata for heterogeneous workflow registration. */
export function getCompiledDefinition(fn: Function): AnyCompiledImplementation | undefined {
  // SAFETY: Only attachWorkflowDefinition writes this private, immutable symbol property.
  // This registry view erases the tuple type; execution uses the matching definition's persisted input.
  return Object.getOwnPropertyDescriptor(fn, COMPILED_WORKFLOW)?.value as
    | AnyCompiledImplementation
    | undefined;
}

export function registerWorkflowFunctions(
  registry: RegistryLike,
  workflows: readonly Function[],
): void {
  for (const workflow of workflows) {
    const definition = getCompiledDefinition(workflow);

    if (definition === undefined) {
      WorkflowDefinitionError.compiledMetadataMissing();
    }

    registry.register(definition);
  }
}

/** Calls a compiled step function through the durable step API when metadata is present. */
export async function callWorkflowStepFunction<TArgs extends readonly unknown[], TOutput>(
  step: StepApi,
  fn: CompiledWorkflowFunction<TArgs, TOutput>,
  ...args: TArgs
): Promise<Awaited<TOutput>> {
  const definition = getWorkflowStepFunctionDefinition(fn);

  if (definition === undefined) {
    return await fn(...args);
  }

  return await step.call(definition, ...args);
}
