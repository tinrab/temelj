import { transformSync } from "esbuild";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import * as workflowRuntime from "../../src/mod.ts";
import { Registry } from "../../src/registry.ts";
import { transformWorkflowSource } from "../../src/vite.ts";

interface EvaluatedWorkflowModule {
  readonly exports: Record<string, unknown>;
}

describe("Vite plugin runtime", () => {
  it("runs a transformed compiled workflow function", async () => {
    const mod = evaluateTransformedWorkflowModule(
      `
export async function addOne(value: number) {
  "use step";
  return value + 1;
}

export async function calculate(value: number) {
  "use workflow";
  const next = await addOne(value);
  return next * 2;
}
`,
    );
    const calculate = mod.exports.calculate as (value: number) => Promise<number>;
    const client = createWorkflowClient();

    const handle = await workflowRuntime.runWorkflowFunction(client, calculate, 20);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
    const events = await client.runs.events(handle.runId);
    expect(events.some((event) => event.kind === "step_started")).toBe(true);
    expect(events.some((event) => event.kind === "step_completed")).toBe(true);
  });

  it("preserves synchronous helper calls while running transformed workflows", async () => {
    const mod = evaluateTransformedWorkflowModule(
      `
function normalize(value: string) {
  return value.trim().toUpperCase();
}

export async function saveValue(value: string) {
  "use step";
  return value;
}

export async function processValue(value: string) {
  "use workflow";
  const normalized = normalize(value);
  const saved = await saveValue(normalized);
  return saved;
}
`,
    );
    const processValue = mod.exports.processValue as (value: string) => Promise<string>;
    const client = createWorkflowClient();

    const handle = await workflowRuntime.runWorkflowFunction(client, processValue, "  abc  ");
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe("ABC");
  });

  it("runs multiple transformed durable steps in workflow order", async () => {
    const mod = evaluateTransformedWorkflowModule(
      `
export async function addOne(value: number) {
  "use step";
  return value + 1;
}

export async function double(value: number) {
  "use step";
  return value * 2;
}

export async function calculate(value: number) {
  "use workflow";
  const next = await addOne(value);
  return await double(next);
}
`,
    );
    const calculate = mod.exports.calculate as (value: number) => Promise<number>;
    const engine = createWorkflowEngine();
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });

    workflowRuntime.registerWorkflowFunctions(registry, [calculate]);
    const handle = await workflowRuntime.runWorkflowFunction(client, calculate, 20);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
    const events = await handle.events();
    expect(
      events.filter((event) => event.kind === "step_started").map((event) => event.stepName),
    ).toEqual(["workflows/runtime.ts:addOne", "workflows/runtime.ts:double"]);
  });

  it("runs local step calls used in Promise.allSettled as durable branches", async () => {
    const mod = evaluateTransformedWorkflowModule(
      `
export async function sendSlack(id: string, message: string) {
  "use step";
  return { channel: "slack", id, message };
}

export async function sendEmail(id: string, message: string) {
  "use step";
  return { channel: "email", id, message };
}

export async function sendSms(id: string, message: string) {
  "use step";
  return { channel: "sms", id, message };
}

export async function fanOutWorkflow(incidentId: string, message: string) {
  "use workflow";
  const settled = await Promise.allSettled([
    sendSlack(incidentId, message),
    sendEmail(incidentId, message),
    sendSms(incidentId, message),
  ]);
  const delivered = settled.filter((item) => item.status === "fulfilled").length;
  return { incidentId, delivered, failed: settled.length - delivered };
}
`,
    );
    const fanOutWorkflow = mod.exports.fanOutWorkflow as (
      incidentId: string,
      message: string,
    ) => Promise<{
      readonly incidentId: string;
      readonly delivered: number;
      readonly failed: number;
    }>;
    const engine = createWorkflowEngine();
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });

    workflowRuntime.registerWorkflowFunctions(registry, [fanOutWorkflow]);
    const handle = await workflowRuntime.runWorkflowFunction(
      client,
      fanOutWorkflow,
      "inc_1",
      "wake up",
    );
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toEqual({
      incidentId: "inc_1",
      delivered: 3,
      failed: 0,
    });
    const events = await handle.events();
    expect(
      events.filter((event) => event.kind === "step_started").map((event) => event.stepName),
    ).toEqual([
      "workflows/runtime.ts:sendSlack",
      "workflows/runtime.ts:sendEmail",
      "workflows/runtime.ts:sendSms",
    ]);
  });

  it("runs imported transformed step calls as durable steps", async () => {
    const steps = transformWorkflowSource(
      `
export async function loadUser(userId: string) {
  "use step";
  return { id: userId, name: userId.toUpperCase() };
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    if (steps === undefined) {
      throw new Error("Expected steps module to transform");
    }
    const main = transformWorkflowSource(
      `
import { loadUser as readUser } from "./steps";

export async function welcomeUser(userId: string) {
  "use workflow";
  const user = await readUser(userId);
  return "hello " + user.name;
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: [steps.manifest] },
    );
    if (main === undefined) {
      throw new Error("Expected main module to transform");
    }

    const modules = evaluateTransformedWorkflowModules({
      "./steps": steps.code,
      "./main": main.code,
    });
    const welcomeUser = modules["./main"]!.exports.welcomeUser as (
      userId: string,
    ) => Promise<string>;
    const client = createWorkflowClient();

    const handle = await workflowRuntime.runWorkflowFunction(client, welcomeUser, "ada");
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe("hello ADA");
    const events = await handle.events();
    expect(
      events.filter((event) => event.kind === "step_started").map((event) => event.stepName),
    ).toEqual(["workflows/steps.ts:loadUser"]);
  });
});

function evaluateTransformedWorkflowModule(source: string): EvaluatedWorkflowModule {
  const transformed = transformWorkflowSource(source, "/repo/workflows/runtime.ts", {
    root: "/repo",
  });
  if (transformed === undefined) {
    throw new Error("Expected workflow source to transform");
  }

  const output = transformSync(transformed.code, {
    format: "cjs",
    loader: "ts",
    target: "es2022",
  });
  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    exports: module.exports,
    module,
    require(specifier: string): unknown {
      if (specifier === "@temelj/workflow") {
        return workflowRuntime;
      }
      throw new Error(`Unexpected module import: ${specifier}`);
    },
  });

  vm.runInContext(output.code, context);

  return { exports: module.exports };
}

function evaluateTransformedWorkflowModules(
  sources: Record<string, string>,
): Record<string, EvaluatedWorkflowModule> {
  const modules: Record<string, { exports: Record<string, unknown>; evaluated: boolean }> = {};
  for (const specifier of Object.keys(sources)) {
    modules[specifier] = { exports: {}, evaluated: false };
  }

  const evaluate = (specifier: string): EvaluatedWorkflowModule => {
    const module = modules[specifier];
    const source = sources[specifier];
    if (module === undefined || source === undefined) {
      throw new Error(`Unexpected module import: ${specifier}`);
    }
    if (module.evaluated) {
      return { exports: module.exports };
    }
    const output = transformSync(source, {
      format: "cjs",
      loader: "ts",
      target: "es2022",
    });
    const context = vm.createContext({
      exports: module.exports,
      module,
      require(requiredSpecifier: string): unknown {
        if (requiredSpecifier === "@temelj/workflow") {
          return workflowRuntime;
        }
        return evaluate(requiredSpecifier).exports;
      },
    });

    vm.runInContext(output.code, context);
    module.evaluated = true;
    return { exports: module.exports };
  };

  for (const specifier of Object.keys(sources)) {
    evaluate(specifier);
  }
  return Object.fromEntries(
    Object.entries(modules).map(([specifier, module]) => [specifier, { exports: module.exports }]),
  );
}
