import type { StepDefinition, StepDefinitionHandler, StepRunConfig } from "./types/step.ts";

import { WorkflowDefinitionError } from "./errors/mod.ts";

/** Defines a durable step whose handler receives context before its typed arguments. */
export function defineWorkflowStep<TArgs extends readonly unknown[], TOutput>(
  config: StepRunConfig,
  handler: StepDefinitionHandler<TArgs, TOutput>,
): StepDefinition<TArgs, TOutput> {
  const commandId = config.commandId ?? config.name;

  if (commandId === undefined) {
    throw new WorkflowDefinitionError("Workflow step name or commandId is required");
  }

  return { config, name: commandId, handler };
}
