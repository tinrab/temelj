import type { Schema } from "@temelj/standard-schema";

import type { CompiledWorkflowFunction } from "../types/client.ts";
import type {
  WorkflowDefinitionConfig,
  WorkflowImplementation,
  RegistryLike,
} from "../types/definition.ts";

import { getCompiledWorkflowDefinition } from "../compiled-function.ts";
import { WorkflowDefinitionError } from "../errors/mod.ts";
import { Registry } from "../registry.ts";

interface CloudflareWorkflowImplementationLike {
  readonly kind: "implementation";
  readonly definition: {
    readonly kind: "definition";
    readonly config: WorkflowDefinitionConfig<Schema | undefined>;
    readonly name: string;
    readonly version?: string;
  };
  readonly config: WorkflowDefinitionConfig<Schema | undefined>;
  readonly name: string;
  readonly version?: string;
  readonly handler: (...args: never[]) => unknown;
}

type CloudflareWorkflowRegistryEntry =
  | CloudflareWorkflowImplementationLike
  | CompiledWorkflowFunction<readonly unknown[], unknown>;

/** Creates a registry shared by the Cloudflare entrypoint and runtime facade. */
export function createCloudflareWorkflowRegistry(
  entries: readonly CloudflareWorkflowRegistryEntry[] = [],
): Registry {
  const registry = new Registry();
  for (const entry of entries) {
    if (typeof entry === "function") {
      const implementation = getCompiledWorkflowDefinition(entry);
      if (implementation === undefined) {
        WorkflowDefinitionError.compiledMetadataMissing();
      }
      registry.register(implementation);
      continue;
    }
    registry.register(entry as WorkflowImplementation<never, unknown, never>);
  }
  return registry;
}

export function resolveCloudflareWorkflowImplementation(
  registry: RegistryLike,
  name: string,
  version?: string,
): WorkflowImplementation<unknown, unknown> {
  const implementation =
    version === undefined ? registry.latest(name) : registry.getByName(name, version);
  if (implementation === undefined) {
    throw new TypeError(
      `Cloudflare Workflow implementation is not registered: ${
        version === undefined ? name : `${name}@${version}`
      }`,
    );
  }
  return implementation;
}
