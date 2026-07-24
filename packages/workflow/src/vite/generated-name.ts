/** Prefix reserved for helper identifiers injected by the workflow transform. */
export const GENERATED_PREFIX: string = "__temelj";

/** Creates a reserved helper identifier for generated workflow transform code. */
export function makeGeneratedName(...parts: readonly string[]): string {
  return [GENERATED_PREFIX, ...parts].join("_");
}
