import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  Registry as RegistryContract,
} from "./types/definition.ts";

import { WorkflowDefinitionError } from "./errors/mod.ts";

/** In-memory workflow registry implementation. */
export class Registry implements RegistryContract {
  private readonly implementations = new Map<string, WorkflowImplementation<unknown, unknown>>();

  /** Defines and registers a workflow implementation. */
  readonly implementWorkflow = <TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> => {
    const implementation: WorkflowImplementation<TInput, TOutput, TRawInput> = {
      kind: "implementation",
      definition,
      config: definition.config,
      name: definition.name,
      ...(definition.version === undefined ? {} : { version: definition.version }),
      handler,
    };
    this.register(implementation);
    return implementation;
  };

  /** Registers a workflow implementation. */
  readonly register = <TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void => {
    const key = makeWorkflowImplementationKey(implementation.name, implementation.version);
    if (this.implementations.has(key)) {
      WorkflowDefinitionError.implementationAlreadyRegistered(key);
    }
    this.implementations.set(key, implementation as WorkflowImplementation<unknown, unknown>);
  };

  /** Returns the workflow implementation registered for a definition. */
  readonly get = <TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> | undefined => {
    return this.implementations.get(
      makeWorkflowImplementationKey(definition.name, definition.version),
    ) as WorkflowImplementation<TInput, TOutput, TRawInput> | undefined;
  };

  /** Returns the workflow implementation registered for a name and optional version. */
  readonly getByName = (
    name: string,
    version?: string,
  ): WorkflowImplementation<unknown, unknown> | undefined =>
    this.implementations.get(makeWorkflowImplementationKey(name, version));

  /** Returns the last registered workflow implementation for a name. */
  readonly latest = (name: string): WorkflowImplementation<unknown, unknown> | undefined => {
    const implementations = this.entries();
    for (let index = implementations.length - 1; index >= 0; index--) {
      const implementation = implementations[index];
      if (implementation.name === name) {
        return implementation;
      }
    }
    return undefined;
  };

  /** Returns all registered workflow implementations in registration order. */
  readonly entries = (): readonly WorkflowImplementation<unknown, unknown>[] => [
    ...this.implementations.values(),
  ];
}

/** Builds the internal registry key for a workflow implementation. */
function makeWorkflowImplementationKey(name: string, version: string | undefined): string {
  return version === undefined ? name : `${name}@${version}`;
}
