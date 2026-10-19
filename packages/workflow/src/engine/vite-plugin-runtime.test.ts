import { isObject, isFunction } from "@temelj/value";
import { transformSync } from "esbuild";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import type { WorkflowImplementation } from "../types/definition.ts";

import { clientForEngine, createWorkflowClient } from "../client/create.ts";
import * as workflowRuntime from "../compiled.ts";
import { registerWorkflowFunctions } from "../mod.ts";
import { Registry } from "../registry.ts";
import { transformWorkflowSource } from "../vite.ts";
import { createWorkflowEngine } from "./create.ts";

interface EvaluatedModule {
  readonly exports: object;
}

describe("Vite plugin runtime", () => {
  it("runs a transformed compiled workflow function", async () => {
    const mod = evaluateTransformedModule(
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

    const calculate = workflowFromModule(mod, "calculate");
    const client = createWorkflowClient();

    client.register(calculate);
    const handle = await client.runs.start(calculate.definition, [20]);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
    const events = await client.runs.events(handle.runId);
    expect(events.some((event) => event.kind === "step_started")).toBe(true);
    expect(events.some((event) => event.kind === "step_completed")).toBe(true);
  });

  it("preserves synchronous helper calls while running transformed workflows", async () => {
    const mod = evaluateTransformedModule(
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

    const processValue = workflowFromModule(mod, "processValue");
    const client = createWorkflowClient();

    client.register(processValue);
    const handle = await client.runs.start(processValue.definition, ["  abc  "]);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe("ABC");
  });

  it("runs multiple transformed durable steps in workflow order", async () => {
    const mod = evaluateTransformedModule(
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

    const calculate = workflowFromModule(mod, "calculate");
    const engine = createWorkflowEngine();
    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    client.register(calculate);
    const handle = await client.runs.start(calculate.definition, [20]);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
    const events = await handle.events();
    expect(
      events.filter((event) => event.kind === "step_started").map((event) => event.stepName),
    ).toEqual(["workflows/runtime.ts:addOne", "workflows/runtime.ts:double"]);
  });

  it("runs local step calls used in Promise.allSettled as durable branches", async () => {
    const mod = evaluateTransformedModule(
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

    const fanOutWorkflow = workflowFromModule(mod, "fanOutWorkflow");

    const engine = createWorkflowEngine();
    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    client.register(fanOutWorkflow);

    const handle = await client.runs.start(fanOutWorkflow.definition, ["inc_1", "wake up"]);

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

    const modules = evaluateTransformedModules({
      "./steps": steps.code,
      "./main": main.code,
    });

    const welcomeUser = workflowFromModule(modules["./main"]!, "welcomeUser");

    const client = createWorkflowClient();

    client.register(welcomeUser);
    const handle = await client.runs.start(welcomeUser.definition, ["Verso"]);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe("hello VERSO");
    const events = await handle.events();
    expect(
      events.filter((event) => event.kind === "step_started").map((event) => event.stepName),
    ).toEqual(["workflows/steps.ts:loadUser"]);
  });
});

function evaluateTransformedModule(source: string): EvaluatedModule {
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

  const module: EvaluatedModuleState = { exports: {}, evaluated: false };

  const context = vm.createContext({
    exports: module.exports,
    module,
    require(specifier: string): typeof workflowRuntime {
      if (specifier === "@temelj/workflow/compiled") {
        return workflowRuntime;
      }

      throw new Error(`Unexpected module import: ${specifier}`);
    },
  });

  vm.runInContext(output.code, context);

  return validatedModule(module);
}

function evaluateTransformedModules(
  sources: Record<string, string>,
): Record<string, EvaluatedModule> {
  const modules: Record<string, EvaluatedModuleState> = {};

  for (const specifier of Object.keys(sources)) {
    modules[specifier] = { exports: {}, evaluated: false };
  }

  const evaluate = (specifier: string): EvaluatedModule => {
    const module = modules[specifier];
    const source = sources[specifier];

    if (module === undefined || source === undefined) {
      throw new Error(`Unexpected module import: ${specifier}`);
    }

    if (module.evaluated) {
      return validatedModule(module);
    }

    const output = transformSync(source, {
      format: "cjs",
      loader: "ts",
      target: "es2022",
    });

    const context = vm.createContext({
      exports: module.exports,
      module,
      require(requiredSpecifier: string): object {
        if (requiredSpecifier === "@temelj/workflow/compiled") {
          return workflowRuntime;
        }

        return evaluate(requiredSpecifier).exports;
      },
    });

    vm.runInContext(output.code, context);
    module.evaluated = true;

    return validatedModule(module);
  };

  for (const specifier of Object.keys(sources)) {
    evaluate(specifier);
  }

  return Object.fromEntries(
    Object.entries(modules).map(([specifier, module]) => [specifier, validatedModule(module)]),
  );
}

interface EvaluatedModuleState {
  exports: unknown;
  evaluated: boolean;
}

function validatedModule(module: EvaluatedModuleState): EvaluatedModule {
  if (!isObject(module.exports)) throw new TypeError("Expected an object of module exports");

  return { exports: module.exports };
}

function workflowFromModule(module: EvaluatedModule, name: string): WorkflowImplementation {
  const exported = Object.entries(module.exports).find(([exportName]) => exportName === name)?.[1];

  if (!isFunction(exported)) throw new TypeError("Expected exported workflow function " + name);
  const registry = new Registry();
  registerWorkflowFunctions(registry, [exported]);
  const workflow = registry.entries()[0];

  if (workflow === undefined) throw new Error("Expected registered compiled workflow " + name);

  return workflow;
}
