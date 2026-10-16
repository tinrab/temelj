import { describe, expect, expectTypeOf, test } from "vitest";

import type { CreateWorkflowClientOptions } from "./client/create.ts";

import { defineWorkflowBundle } from "./bundle.ts";
import { clientForEngine, createWorkflowClient } from "./client/create.ts";
import { attachWorkflowDefinition } from "./compiled-function.ts";
import { implementWorkflow } from "./definition.ts";
import { createWorkflowEngine } from "./engine/create.ts";
import { WorkflowDefinitionError } from "./errors/mod.ts";
import { Registry } from "./registry.ts";

describe("workflow bundles", () => {
  test("copies entries and preserves registration order", () => {
    const first = implementWorkflow<undefined, string>({ name: "bundle-first" }, () => "first");
    const second = implementWorkflow<undefined, string>({ name: "bundle-second" }, () => "second");
    const entries = [first];

    const bundle = defineWorkflowBundle(entries);
    entries.push(second);

    expect(bundle.workflows).toEqual([first]);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.workflows)).toBe(true);
  });

  test("normalizes compiled workflow functions", () => {
    const implementation = implementWorkflow<[number], number, [number]>(
      { name: "bundle-compiled" },
      ({ input }) => input[0] * 2,
    );

    const compiled = attachWorkflowDefinition(async (value: number) => value * 2, implementation);

    const bundle = defineWorkflowBundle([compiled]);

    expect(bundle.workflows).toEqual([implementation]);
  });

  test("rejects duplicate workflow names and versions", () => {
    const first = implementWorkflow<undefined, void>({ name: "bundle-duplicate" }, () => {});
    const second = implementWorkflow<undefined, void>({ name: "bundle-duplicate" }, () => {});

    expect(() => defineWorkflowBundle([first, second])).toThrow(WorkflowDefinitionError);
  });

  test("registers bundled workflows with local runtimes", async () => {
    const workflow = implementWorkflow<number, number>(
      { name: "bundle-runtime" },
      ({ input }) => input * 2,
    );

    const runtime = createWorkflowClient({ workflows: defineWorkflowBundle([workflow]) });

    const handle = await runtime.runs.start(workflow.definition, 21);
    await runtime.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
  });

  test("registers bundled workflows with local clients", async () => {
    const workflow = implementWorkflow<number, number>(
      { name: "bundle-client" },
      ({ input }) => input + 1,
    );

    const client = createWorkflowClient({ workflows: defineWorkflowBundle([workflow]) });

    const handle = await client.runs.start(workflow.definition, 41);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
  });

  test("rejects ambiguous registry and bundle options", () => {
    const workflow = implementWorkflow<undefined, void>({ name: "bundle-options" }, () => {});
    const options = { registry: new Registry(), workflows: defineWorkflowBundle([workflow]) };

    expectTypeOf<CreateWorkflowClientOptions>().not.toHaveProperty("registry");
    // @ts-expect-error Exercise the runtime check for conflicting options.
    expect(() => clientForEngine(createWorkflowEngine(), options)).toThrow(
      "cannot include both registry and workflows",
    );
  });
});
