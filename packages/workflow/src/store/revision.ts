import { deepEquals } from "@temelj/value";

// Storage revisions compare semantic values. Object property insertion order is not persisted state.
export function isSameWorkflowStorageValue(left: unknown, right: unknown): boolean {
  return deepEquals(left, right);
}
