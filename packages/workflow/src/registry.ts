import { isFunction } from "@temelj/value";

import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  Registry as RegistryContract,
} from "./types/definition.ts";

import { getCompiledWorkflowDefinition } from "./compiled-function.ts";
import { WorkflowDefinitionError } from "./errors/mod.ts";

/** A compiled function or implementation accepted by a heterogeneous registry. */
export type WorkflowRegistryEntry =
  | Function
  | (Omit<WorkflowImplementation, "handler"> & { readonly handler: Function });

/** In-memory workflow registry implementation. */
export class Registry implements RegistryContract {
  private readonly implementations = new Map<string, WorkflowImplementation<unknown, unknown>>();

  constructor(entries: readonly WorkflowRegistryEntry[] = []) {
    for (const entry of entries) {
      if (isFunction(entry)) {
        const implementation = getCompiledWorkflowDefinition(entry);

        if (implementation === undefined) {
          WorkflowDefinitionError.compiledMetadataMissing();
        }

        this.register(implementation);
      } else {
        // SAFETY: Heterogeneous registration erases the input type while keeping
        // the original definition and its handler together, as register does.
        this.register(entry as WorkflowImplementation<unknown, unknown>);
      }
    }
  }

  /** Defines and registers a workflow implementation. */
  readonly implementWorkflow = <TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> => {
    const result = {
      kind: "implementation",
      definition,
      config: definition.config,
      name: definition.name,
    } satisfies Partial<WorkflowImplementation<TInput, TOutput, TRawInput>>;

    if (definition.version !== undefined) {
      Object.assign(result, { version: definition.version } satisfies Partial<
        WorkflowImplementation<TInput, TOutput, TRawInput>
      >);
    }

    const result1 = Object.assign(result, { handler } satisfies Partial<
      WorkflowImplementation<TInput, TOutput, TRawInput>
    >);

    const implementation: WorkflowImplementation<TInput, TOutput, TRawInput> = result1;

    this.register(implementation);

    return implementation;
  };

  /** Registers a workflow implementation. */
  readonly register = <TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void => {
    const key = makeWorkflowImplementationKey(implementation.name, implementation.version);

    if (this.implementations.has(key)) {
      WorkflowDefinitionError.implementationAlreadyRegistered(
        implementation.version === undefined
          ? implementation.name
          : `${implementation.name}@${implementation.version}`,
      );
    }

    // SAFETY: Registration preserves the original definition and handler together.
    // This heterogeneous index erases their types; typed lookup below checks definition identity.
    this.implementations.set(key, implementation as WorkflowImplementation<unknown, unknown>);
  };

  /** Returns the workflow implementation registered for a definition. */
  readonly get = <TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput> | undefined => {
    const implementation = this.implementations.get(
      makeWorkflowImplementationKey(definition.name, definition.version),
    );

    if (implementation?.definition !== definition) {
      return undefined;
    }

    // SAFETY: The exact definition object is the one supplied with this handler to register.
    return implementation as WorkflowImplementation<TInput, TOutput, TRawInput>;
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
  return JSON.stringify([name, version ?? null]);
}
