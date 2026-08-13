import type { Schema } from "@temelj/standard-schema";

import type {
  WorkflowDefinitionConfig,
  WorkflowImplementation,
  Registry as RegistryContract,
} from "./types/definition.ts";

import { getCompiledWorkflowDefinition } from "./compiled-function.ts";
import { WorkflowDefinitionError } from "./errors/mod.ts";
import { Registry } from "./registry.ts";

interface WorkflowImplementationLike {
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

/** Workflow value accepted by an immutable workflow bundle. */
export type WorkflowBundleEntry = WorkflowImplementationLike | ((...args: never[]) => unknown);

/** Immutable collection of workflow implementations shared by workflow hosts. */
export interface WorkflowBundle {
  readonly kind: "workflow-bundle";
  readonly workflows: readonly WorkflowImplementation<unknown, unknown>[];
}

/** Defines an immutable workflow collection for local and deployed workflow hosts. */
export function defineWorkflowBundle(entries: readonly WorkflowBundleEntry[]): WorkflowBundle {
  const registry = new Registry();
  for (const entry of entries) {
    registry.register(workflowImplementationFromBundleEntry(entry));
  }
  return Object.freeze({
    kind: "workflow-bundle" as const,
    workflows: Object.freeze([...registry.entries()]),
  });
}

/** Creates an independent mutable registry populated from a workflow bundle. */
export function createWorkflowBundleRegistry(bundle: WorkflowBundle): RegistryContract {
  const registry = new Registry();
  for (const workflow of bundle.workflows) {
    registry.register(workflow);
  }
  return registry;
}

function workflowImplementationFromBundleEntry(
  entry: WorkflowBundleEntry,
): WorkflowImplementation<unknown, unknown> {
  if (typeof entry !== "function") {
    return entry as WorkflowImplementation<unknown, unknown>;
  }
  const implementation = getCompiledWorkflowDefinition(entry);
  if (implementation === undefined) {
    WorkflowDefinitionError.compiledMetadataMissing();
  }
  return implementation as WorkflowImplementation<unknown, unknown>;
}
