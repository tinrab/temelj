import type { WorkflowRegistryEntry } from "./registry.ts";
import type { WorkflowImplementation } from "./types/definition.ts";

import { Registry } from "./registry.ts";

/** Immutable collection of workflow implementations shared by workflow hosts. */
export interface WorkflowBundle {
  readonly kind: "workflow-bundle";
  readonly workflows: readonly WorkflowImplementation<unknown, unknown>[];
}

/** Defines an immutable workflow collection for local and deployed workflow hosts. */
export function defineWorkflowBundle(entries: readonly WorkflowRegistryEntry[]): WorkflowBundle {
  const registry = new Registry(entries);

  return Object.freeze({
    kind: "workflow-bundle" as const,
    workflows: Object.freeze([...registry.entries()]),
  });
}
