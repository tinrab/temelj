import { describe, expect, it } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import {
  attachWorkflowStepDefinition,
  attachWorkflowDefinition,
  callWorkflowStepFunction,
  implementWorkflow,
  defineWorkflowStep,
  getWorkflowStepFunctionDefinition,
  getWorkflowFunctionDefinition,
  runWorkflowFunction,
} from "../../src/mod.ts";
import { Registry } from "../../src/registry.ts";

describe("compiled workflow function helpers", () => {
  it("attaches and reads workflow and step metadata", () => {
    const stepFn = async (value: number) => value + 1;
    const workflowFn = async (value: number) => value * 2;
    const step = defineWorkflowStep({ name: "increment" }, async (value: number) => value + 1);
    const workflow = implementWorkflow<[number], number, [number]>(
      { name: "double" },
      async ({ input }) => input[0] * 2,
    );

    attachWorkflowStepDefinition(stepFn, step);
    attachWorkflowDefinition(workflowFn, workflow);

    expect(getWorkflowStepFunctionDefinition(stepFn)).toBe(step);
    expect(getWorkflowFunctionDefinition(workflowFn)).toBe(workflow);
  });

  it("registers and runs compiled workflow functions through the client", async () => {
    const client = createWorkflowClient();
    const workflowFn = async (value: number) => value * 2;
    const workflow = implementWorkflow<[number], number, [number]>(
      { name: "compiled-double" },
      async ({ input }) => {
        return input[0] * 2;
      },
    );
    attachWorkflowDefinition(workflowFn, workflow);

    client.register(workflow);
    const handle = await runWorkflowFunction(client, workflowFn, 21);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
  });

  it("calls attached steps through durable step.task.call", async () => {
    const engine = createWorkflowEngine();
    const registry = new Registry();
    const stepFn = async (value: number) => value + 1;
    const step = defineWorkflowStep({ name: "compiled-increment" }, async (value: number) => {
      return value + 1;
    });
    attachWorkflowStepDefinition(stepFn, step);
    const workflow = implementWorkflow<[number], number, [number]>(
      { name: "compiled-step-call" },
      async ({ input, step }) => {
        return await callWorkflowStepFunction(step, stepFn, input[0]);
      },
    );
    registry.register(workflow);
    const client = createWorkflowClient({ engine, registry });
    const handle = await client.runs.start(workflow, [4]);

    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(5);
    const events = await client.runs.events(handle.runId);
    expect(events.some((event) => event.kind === "step_started")).toBe(true);
    expect(events.some((event) => event.kind === "step_completed")).toBe(true);
  });
});
