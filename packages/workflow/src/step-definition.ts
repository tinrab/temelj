import type {
  WorkflowStepDefinition,
  WorkflowStepDefinitionHandler,
  WorkflowStepRunConfig,
  WorkflowStepContext,
} from "./types/step.ts";

import { WorkflowDefinitionError } from "./errors/mod.ts";

type WorkflowStepHandler = (...args: never[]) => unknown;

type WorkflowStepHandlerInputTuple<THandler extends WorkflowStepHandler> = THandler extends (
  ...args: infer TArgs
) => unknown
  ? TArgs
  : never;

type WorkflowStepHandlerArgs<THandler extends WorkflowStepHandler> =
  WorkflowStepHandlerInputTuple<THandler> extends [...infer TArgs, WorkflowStepContext]
    ? TArgs
    : WorkflowStepHandlerInputTuple<THandler>;

type WorkflowStepHandlerOutput<THandler extends WorkflowStepHandler> = THandler extends (
  ...args: never[]
) => infer TOutput
  ? Awaited<TOutput>
  : never;

/** Defines a workflow step. */
export function defineWorkflowStep<THandler extends WorkflowStepHandler>(
  config: WorkflowStepRunConfig,
  handler: THandler,
): WorkflowStepDefinition<WorkflowStepHandlerArgs<THandler>, WorkflowStepHandlerOutput<THandler>> {
  const commandId = config.commandId ?? config.name;
  if (commandId === undefined) {
    WorkflowDefinitionError.stepNameOrCommandIdRequired();
  }

  return {
    config,
    name: commandId,
    handler: handler as unknown as WorkflowStepDefinitionHandler<
      WorkflowStepHandlerArgs<THandler>,
      WorkflowStepHandlerOutput<THandler>
    >,
  };
}
