import { describe, expect, test } from "vitest";

import { attachWorkflowDefinition } from "../src/compiled-function.ts";
import { defineWorkflow, implementWorkflow } from "../src/definition.ts";
import { Registry } from "../src/registry.ts";

describe("workflow registry identity", () => {
  test("constructs a registry from implementations and compiled functions", () => {
    const direct = implementWorkflow<string, string>({ name: "direct" }, ({ input }) => input);

    const compiled = implementWorkflow<[number], number>(
      { name: "compiled" },
      ({ input }) => input[0],
    );

    const fn = attachWorkflowDefinition((value: number) => value, compiled);
    const registry = new Registry([direct, fn]);

    expect(registry.entries()).toEqual([direct, compiled]);
    expect(registry.get(direct.definition)).toBe(direct);
    expect(registry.get(compiled.definition)).toBe(compiled);
    expect(() => new Registry([() => 1])).toThrow("metadata");
    expect(() => new Registry([direct, direct])).toThrow("already registered");
  });

  test("typed lookups require the original definition object", () => {
    const registry = new Registry();
    const definition = defineWorkflow<number, number>({ name: "shared-name" });
    const implementation = registry.implementWorkflow(definition, ({ input }) => input + 1);
    const unrelated = defineWorkflow<string, string>({ name: "shared-name" });

    expect(registry.get(definition)).toBe(implementation);
    expect(registry.get(unrelated)).toBeUndefined();
    expect(registry.getByName("shared-name")).toBe(implementation);
  });

  test("keeps workflow names separate from version delimiters", () => {
    const registry = new Registry();
    const named = implementWorkflow<undefined, string>({ name: "task@v1" }, () => "named");

    const versioned = implementWorkflow<undefined, string>(
      { name: "task", version: "v1" },
      () => "versioned",
    );

    registry.register(named);
    registry.register(versioned);

    expect(registry.getByName("task@v1")).toBe(named);
    expect(registry.getByName("task", "v1")).toBe(versioned);
    expect(registry.entries()).toEqual([named, versioned]);
    expect(registry.latest("task")).toBe(versioned);
    expect(() => registry.register(versioned)).toThrow("already registered");
  });
});
