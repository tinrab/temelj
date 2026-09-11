import type {
  WorkflowStepDefinition,
  WorkflowStepDefinitionHandler,
  WorkflowStepRunConfig,
} from "./types/step.ts";

import { WorkflowDefinitionError } from "./errors/mod.ts";

/** Defines a durable step whose handler receives context before its typed arguments. */
export function defineWorkflowStep<TArgs extends readonly unknown[], TOutput>(
  config: WorkflowStepRunConfig,
  handler: WorkflowStepDefinitionHandler<TArgs, TOutput>,
): WorkflowStepDefinition<TArgs, TOutput> {
  const commandId = config.commandId ?? config.name;

  if (commandId === undefined) {
    WorkflowDefinitionError.stepNameOrCommandIdRequired();
  }

  return { config, name: commandId, handler };
}
