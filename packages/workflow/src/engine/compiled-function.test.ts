import { describe, expect, it } from "vitest";

import { clientForEngine, createWorkflowClient } from "../client/create.ts";
import {
  attachWorkflowDefinition,
  attachWorkflowStepDefinition,
  callWorkflowStepFunction,
} from "../compiled.ts";
import {
  defineWorkflowStep,
  getWorkflowFunctionDefinition,
  getWorkflowStepFunctionDefinition,
  implementWorkflow,
} from "../mod.ts";
import { Registry } from "../registry.ts";
import { createWorkflowEngine } from "./create.ts";

describe("compiled workflow function helpers", () => {
  it("carries immutable metadata on the function without changing its call behavior", () => {
    const fn = (value: number) => value * 2;

    const first = implementWorkflow<[number], number>(
      { name: "first" },
      ({ input }) => input[0] * 2,
    );

    const second = implementWorkflow<[number], number>(
      { name: "second" },
      ({ input }) => input[0] * 3,
    );

    expect(attachWorkflowDefinition(fn, first)).toBe(fn);
    expect(fn(21)).toBe(42);

    const descriptors = Object.getOwnPropertySymbols(fn).map((symbol) =>
      Object.getOwnPropertyDescriptor(fn, symbol),
    );

    expect(descriptors).toEqual([
      { value: first, writable: false, enumerable: false, configurable: false },
    ]);
    expect(() => attachWorkflowDefinition(fn, first)).not.toThrow();
    expect(() => attachWorkflowDefinition(fn, second)).toThrow(TypeError);
    expect(getWorkflowFunctionDefinition(fn)).toBe(first);
  });

  it("attaches and reads workflow and step metadata", () => {
    const stepFn = async (value: number) => value + 1;
    const workflowFn = async (value: number) => value * 2;

    const step = defineWorkflowStep(
      { name: "increment" },
      async (_context, value: number) => value + 1,
    );

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
    const handle = await client.runs.start(workflowFn, 21);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
  });

  it("calls attached steps through durable step.call", async () => {
    const engine = createWorkflowEngine();
    const registry = new Registry();
    const stepFn = async (value: number) => value + 1;

    const step = defineWorkflowStep(
      { name: "compiled-increment" },
      async (_context, value: number) => {
        return value + 1;
      },
    );

    attachWorkflowStepDefinition(stepFn, step);

    const workflow = implementWorkflow<[number], number, [number]>(
      { name: "compiled-step-call" },
      async ({ input, step }) => {
        return await callWorkflowStepFunction(step, stepFn, input[0]);
      },
    );

    registry.register(workflow);
    const client = clientForEngine(engine, { registry });
    const handle = await client.runs.start(workflow, [4]);

    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(5);
    const events = await client.runs.events(handle.runId);
    expect(events.some((event) => event.kind === "step_started")).toBe(true);
    expect(events.some((event) => event.kind === "step_completed")).toBe(true);
  });
});
