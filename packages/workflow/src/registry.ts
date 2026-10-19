// Installs Temporal when the runtime lacks it, before any module uses it.
import "temporal-polyfill/global";
import { isFunction } from "@temelj/value";

import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  Registry as RegistryContract,
} from "./types/definition.ts";

import { getCompiledDefinition } from "./compiled-function.ts";
import { WorkflowDefinitionError } from "./errors/mod.ts";

/** A compiled function or implementation accepted by a heterogeneous registry. */
export type RegistryEntry =
  | Function
  | (Omit<WorkflowImplementation, "handler"> & { readonly handler: Function });

export class Registry implements RegistryContract {
  private readonly implementations = new Map<string, WorkflowImplementation<unknown, unknown>>();

  constructor(entries: readonly RegistryEntry[] = []) {
    for (const entry of entries) {
      if (isFunction(entry)) {
        const implementation = getCompiledDefinition(entry);

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
    const implementation: WorkflowImplementation<TInput, TOutput, TRawInput> = {
      kind: "implementation",
      definition,
      config: definition.config,
      name: definition.name,
      version: definition.version,
      handler,
    };

    this.register(implementation);

    return implementation;
  };

  readonly register = <TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void => {
    const key = makeImplementationKey(implementation.name, implementation.version);

    if (this.implementations.has(key)) {
      throw new WorkflowDefinitionError(
        `Workflow implementation already registered: ${
          implementation.version === undefined
            ? implementation.name
            : `${implementation.name}@${implementation.version}`
        }`,
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
      makeImplementationKey(definition.name, definition.version),
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
    this.implementations.get(makeImplementationKey(name, version));

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

function makeImplementationKey(name: string, version: string | undefined): string {
  return JSON.stringify([name, version ?? null]);
}
