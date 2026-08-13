import { describe, expect, test } from "vitest";

import type { CreateWorkflowClientOptions } from "../src/client/create.ts";
import type { CreateWorkflowRuntimeOptions } from "../src/types/runtime.ts";

import { defineWorkflowBundle } from "../src/bundle.ts";
import { createWorkflowClient } from "../src/client/create.ts";
import { attachWorkflowDefinition } from "../src/compiled-function.ts";
import { implementWorkflow } from "../src/definition.ts";
import { WorkflowDefinitionError } from "../src/errors/mod.ts";
import { Registry } from "../src/registry.ts";
import { createWorkflowRuntime } from "../src/runtime.ts";

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
    const runtime = createWorkflowRuntime({ workflows: defineWorkflowBundle([workflow]) });

    const handle = await runtime.start(workflow.definition, 21);
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
    const bundle = defineWorkflowBundle([workflow]);
    const registry = new Registry();

    const runtimeOptions = {
      registry,
      workflows: bundle,
    } as unknown as CreateWorkflowRuntimeOptions;
    const clientOptions = { registry, workflows: bundle } as unknown as CreateWorkflowClientOptions;

    expect(() => createWorkflowRuntime(runtimeOptions)).toThrow(
      "cannot include both registry and workflows",
    );
    expect(() => createWorkflowClient(clientOptions)).toThrow(
      "cannot include both registry and workflows",
    );
  });
});
