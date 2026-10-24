import type { Workflow as NativeCloudflareWorkflow } from "@cloudflare/workers-types";

import { ss } from "@temelj/standard-schema";
import { isFunction } from "@temelj/value";
import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";

import type { WorkflowRuntime } from "../types/runtime.ts";
import type { CloudflareWorkflowRuntime } from "./runtime.ts";
import type {
  CloudflareWorkflowBinding,
  CloudflareWorkflowEvent,
  CloudflareWorkflowInstance,
  CloudflareWorkflowInstanceCreateOptions,
  CloudflareWorkflowInstanceStatus,
  CloudflareWorkflowStep,
  CloudflareWorkflowStepConfig,
  CloudflareWorkflowStepContext,
  CloudflareWorkflowStepEvent,
} from "./types.ts";

import { defineWorkflowBundle } from "../bundle.ts";
import { defineWorkflow, implementWorkflow } from "../definition.ts";
import { WorkflowCapabilityError } from "../errors/mod.ts";
import { Registry } from "../registry.ts";
import { runCloudflareWorkflow } from "./execution.ts";
import { createCloudflareWorkflowHost } from "./host.ts";
import { createCloudflareWorkflowRuntime } from "./runtime.ts";
import { createCloudflareStepApi } from "./step.ts";

describe("Cloudflare Workflow adapter", () => {
  test("recovers an idempotent start whose creation acknowledgement was lost", async () => {
    let executions = 0;

    const workflow = implementWorkflow<undefined, number>(
      { name: "lost-start-receipt" },
      () => ++executions,
    );

    const registry = new Registry([workflow]);
    const binding = new TestCloudflareBinding(registry);

    const runtime = createCloudflareWorkflowRuntime({
      registry,
      binding: {
        create: (options) => binding.create(options),
        createBatch: async (options) => {
          await binding.createBatch(options);
          throw new Error("Creation acknowledgement lost");
        },
        get: (id) => binding.get(id),
      },
    });

    const handle = await runtime.runs.start(workflow, undefined, { idempotencyKey: "purchase-1" });
    await expect(handle.result()).resolves.toBe(1);
    expect(binding.createCount).toBe(1);
  });

  test("preserves a rejected creation error when idempotent recovery finds no instance", async () => {
    const workflow = implementWorkflow<undefined, void>(
      { name: "rejected-start" },
      () => undefined,
    );

    const failure = new Error("Creation rejected");

    const runtime = createCloudflareWorkflowRuntime({
      registry: new Registry([workflow]),
      binding: {
        create: async () => {
          throw failure;
        },
        createBatch: async () => {
          throw failure;
        },
        get: async () => {
          throw new Error("Instance does not exist");
        },
      },
    });

    await expect(
      runtime.runs.start(workflow, undefined, { idempotencyKey: "rejected-1" }),
    ).rejects.toBe(failure);
  });

  test("accepts a native Workflow binding without an application adapter", () => {
    expectTypeOf<NativeCloudflareWorkflow>().toExtend<CloudflareWorkflowBinding>();
  });

  test.each([1, 3, 10])(
    "runs at most %i attempts including the initial call",
    async (maximumAttempts) => {
      const durableStep = new TestCloudflareStep();
      const step = createCloudflareStepApi({ step: durableStep });
      let attempts = 0;

      await expect(
        step.run({ name: "failing-task", retry: { maximumAttempts } }, () => {
          attempts++;
          throw new Error("Task failed");
        }),
      ).rejects.toThrow("Task failed");
      expect(attempts).toBe(maximumAttempts);
    },
  );

  test("omits an unspecified timeout instead of overriding the native default", async () => {
    const durableStep = new TestCloudflareStep();
    const step = createCloudflareStepApi({ step: durableStep });
    await expect(step.run({ name: "default-timeout" }, () => "done")).resolves.toBe("done");
    expect(durableStep.configurations[0]).not.toHaveProperty("timeout");
  });

  test("represents the native maximum retry budget and keeps zero delay finite", async () => {
    const durableStep = new TestCloudflareStep();
    const step = createCloudflareStepApi({ step: durableStep });
    await step.run(
      { name: "maximum-retries", retry: { maximumAttempts: 10_001 } },
      () => undefined,
    );
    expect(durableStep.configurations[0]?.retries?.limit).toBe(10_000);
    const delay = durableStep.configurations[0]?.retries?.delay;

    if (!isFunction(delay)) {
      throw new Error("Expected a dynamic retry delay");
    }

    expect(
      await delay({ ctx: testStepContext("maximum-retries", 10_000), error: new Error("retry") }),
    ).toBe(0);
    await expect(
      step.run({ name: "excess-retries", retry: { maximumAttempts: 10_002 } }, () => undefined),
    ).rejects.toThrow("at most 10001 attempts");
  });

  test("keeps rollback in progress nonterminal until the instance terminates", async () => {
    const workflow = implementWorkflow<undefined, void>(
      { name: "rollback-status" },
      () => undefined,
    );

    let state: CloudflareWorkflowInstanceStatus = { status: "rollingBack" };

    const instance = {
      id: "rollback-1",
      status: async () => state,
      terminate: async () => undefined,
      sendEvent: async () => undefined,
    };

    const runtime = createCloudflareWorkflowRuntime({
      registry: new Registry([workflow]),
      binding: {
        create: async () => instance,
        createBatch: async () => [instance],
        get: async () => instance,
      },
    });

    const handle = await runtime.runs.get(workflow, "rollback-1");
    await expect(handle.status()).resolves.toBe("running");
    await expect(handle.getRun()).resolves.toMatchObject({
      status: "running",
      finishedAt: undefined,
    });
    state = { status: "terminated" };
    await expect(handle.status()).resolves.toBe("canceled");
  });

  test("requires registered targets and dispatches their exact version", async () => {
    const unversioned = implementWorkflow<undefined, string>(
      { name: "exact-version" },
      () => "unversioned",
    );

    const versioned = implementWorkflow<undefined, number>(
      { name: "exact-version", version: "v1" },
      () => 1,
    );

    const registry = new Registry([unversioned, versioned]);
    const binding = new TestCloudflareBinding(registry);
    const runtime = createCloudflareWorkflowRuntime({ registry, binding });

    await expect(
      runtime.runs.start(unversioned, undefined, { workflowVersion: "v1" }),
    ).rejects.toThrow("version mismatch");
    await expect(
      runtime.runs.start(defineWorkflow({ name: "exact-version" }), undefined),
    ).rejects.toThrow("registered definition");
    expect(binding.createCount).toBe(0);

    const handle = await runtime.runs.start(unversioned, undefined);
    await expect(handle.result()).resolves.toBe("unversioned");
  });

  test("rejects results from a different workflow or version", async () => {
    const first = implementWorkflow<undefined, string>(
      { name: "result-owner", version: "v1" },
      () => "first",
    );

    const second = implementWorkflow<undefined, number>(
      { name: "result-owner", version: "v2" },
      () => 2,
    );

    const unrelated = implementWorkflow<undefined, number>(
      { name: "unrelated", version: "v1" },
      () => 3,
    );

    const registry = new Registry([first, second, unrelated]);

    const runtime = createCloudflareWorkflowRuntime({
      registry,
      binding: new TestCloudflareBinding(registry),
    });

    const handle = await runtime.runs.start(first, undefined);
    await expect(handle.result()).resolves.toBe("first");

    for (const target of [second, unrelated]) {
      const wrong = await runtime.runs.get(target, handle.runId);
      await expect(wrong.result()).rejects.toThrow("does not match");
      await expect(wrong.getRun()).rejects.toThrow("does not match");
    }
  });

  test("validates the original input when a workflow schema transforms it", async () => {
    const workflow = implementWorkflow(
      {
        name: "cloudflare-transformed-input",
        schema: z.string().transform((value) => Number(value) + 1),
      },
      ({ input }) => input + 1,
    );

    const registry = new Registry([workflow]);
    const binding = new TestCloudflareBinding(registry);
    const runtime = createCloudflareWorkflowRuntime({ binding, registry });
    const handle = await runtime.runs.start(workflow, "40");

    await expect(handle.result()).resolves.toBe(42);
  });

  test("creates a static Cloudflare host from a workflow bundle", async () => {
    const workflow = implementWorkflow<number, number>(
      { name: "cloudflare-host" },
      ({ input }) => input * 2,
    );

    const host = createCloudflareWorkflowHost({
      workflows: defineWorkflowBundle([workflow]),
    });

    const binding = new TestCloudflareBinding(new Registry([workflow]));
    const runtime = host.createRuntime(binding);

    const handle = await runtime.runs.start(workflow, 21, { id: "host-1" });

    await expect(handle.result()).resolves.toBe(42);
    expect(host.Entrypoint).toBeTypeOf("function");
  });

  test("rejects workflows omitted from a static Cloudflare host", async () => {
    const bundled = implementWorkflow<undefined, string>(
      { name: "cloudflare-bundled" },
      () => "bundled",
    );

    const omitted = implementWorkflow<undefined, string>(
      { name: "cloudflare-omitted" },
      () => "omitted",
    );

    const host = createCloudflareWorkflowHost({
      workflows: defineWorkflowBundle([bundled]),
    });

    const binding = new TestCloudflareBinding(new Registry([bundled]));
    const runtime = host.createRuntime(binding);

    await expect(runtime.runs.start(omitted, undefined)).rejects.toThrow(
      "Workflow implementation is not included in the workflow bundle: cloudflare-omitted",
    );
    expect(binding.createCount).toBe(0);
  });

  test("runs Temelj tasks, sleeps, deterministic commands, and results through Cloudflare", async () => {
    const workflow = implementWorkflow<{ readonly value: number }, number>(
      { name: "cloudflare-core" },
      async ({ input, step }) => {
        const random = await step.deterministic.random("seed");

        const value = await step.run(
          {
            name: "double",
            retry: {
              maximumAttempts: 3,
              initialInterval: Temporal.Duration.from({ seconds: 2 }),
              backoffCoefficient: 3,
              maximumInterval: Temporal.Duration.from({ seconds: 5 }),
            },
          },
          ({ attempt, step: metadata }) => {
            expect(attempt).toBe(1);
            expect(metadata.name).toBe("double");

            return input.value * 2;
          },
        );

        await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));

        return value + random;
      },
    );

    const registry = new Registry([workflow]);
    const binding = new TestCloudflareBinding(registry);
    const runtime = createCloudflareWorkflowRuntime({ binding, registry });

    const handle = await runtime.runs.start(workflow, { value: 20 }, { id: "core-1" });

    const result = await handle.result();
    expect(result).toBeGreaterThanOrEqual(40);
    expect(result).toBeLessThan(41);
    await expect(handle.status()).resolves.toBe("completed");
    expect(binding.step.sleeps).toHaveLength(1);
    expect(binding.step.sleeps[0]?.duration).toBe(1_000);
    expect(binding.step.sleeps[0]?.name).toMatch(/^pause-[a-z0-9]+$/);
    expect(binding.step.configurations[1]?.retries?.limit).toBe(2);
    const delay = binding.step.configurations[1]?.retries?.delay;

    if (!isFunction(delay)) {
      throw new Error("Expected a dynamic retry delay");
    }

    expect(
      await delay({
        ctx: testStepContext("double", 2),
        error: new Error("retry"),
      }),
    ).toBe(5_000);
  });

  test("waits for and validates messages sent through the runtime facade", async () => {
    const workflow = implementWorkflow<undefined, { readonly approved: boolean }>(
      { name: "cloudflare-message" },
      async ({ step }) =>
        await step.message.wait({
          schema: ss.object({ approved: ss.boolean() }),
          messageId: "approval.received",
          timeout: Temporal.Duration.from({ minutes: 5 }),
        }),
    );

    const registry = new Registry([workflow]);
    const binding = new TestCloudflareBinding(registry);
    const runtime = createCloudflareWorkflowRuntime({ binding, registry });

    const handle = await runtime.runs.start(workflow, undefined, { id: "message-1" });
    await runtime.messages.send(handle.runId, {
      messageId: "approval.received",
      payload: { approved: true },
    });

    await expect(handle.result()).resolves.toEqual({ approved: true });
    expect(binding.step.waits[0]).toMatchObject({
      timeout: 300_000,
    });
    expect(binding.step.waits[0]?.type).toMatch(/^approval-received-[a-z0-9]+$/);
  });

  test("rejects retry settings that Cloudflare cannot represent", async () => {
    const workflow = implementWorkflow<undefined, void>(
      { name: "cloudflare-limits" },
      async ({ step }) => {
        await step.run(
          {
            name: "unbounded",
            retry: { maximumAttempts: 0 },
          },
          () => undefined,
        );
      },
    );

    const registry = new Registry([workflow]);

    const runtime = createCloudflareWorkflowRuntime({
      binding: new TestCloudflareBinding(registry),
      registry,
    });

    const handle = await runtime.runs.start(workflow, undefined, { id: "limits-1" });
    await expect(handle.result()).rejects.toThrow(
      "Cloudflare Workflow steps support at most 10001 attempts",
    );
  });

  test("rejects step timeouts longer than Cloudflare's 30 minute limit", async () => {
    const workflow = implementWorkflow<undefined, void>(
      { name: "cloudflare-timeout-limit" },
      async ({ step }) => {
        await step.run(
          {
            name: "too-long",
            timeout: Temporal.Duration.from({ minutes: 31 }),
          },
          () => undefined,
        );
      },
    );

    const registry = new Registry([workflow]);

    const runtime = createCloudflareWorkflowRuntime({
      binding: new TestCloudflareBinding(registry),
      registry,
    });

    const handle = await runtime.runs.start(workflow, undefined, { id: "timeout-limit-1" });
    await expect(handle.result()).rejects.toThrow(
      "Cloudflare Workflow step timeout must not exceed 1800000 milliseconds",
    );
  });

  test("cancel is idempotent after a run reaches a terminal state", async () => {
    const workflow = implementWorkflow<undefined, string>(
      { name: "cloudflare-cancel" },
      () => "done",
    );

    const registry = new Registry([workflow]);
    const binding = new TestCloudflareBinding(registry);
    const runtime = createCloudflareWorkflowRuntime({ binding, registry });
    const handle = await runtime.runs.start(workflow, undefined, { id: "cancel-1" });

    await expect(handle.result()).resolves.toBe("done");
    await expect(handle.cancel()).resolves.toMatchObject({ status: "completed" });
    expect(binding.instance("cancel-1").terminateCount).toBe(0);
  });

  test("exposes only what Cloudflare supports, and keeps the full step API", async () => {
    expectTypeOf<CloudflareWorkflowRuntime>().not.toHaveProperty("locks");
    expectTypeOf<CloudflareWorkflowRuntime>().not.toHaveProperty("schedules");
    expectTypeOf<CloudflareWorkflowRuntime>().not.toHaveProperty("workers");
    expectTypeOf<CloudflareWorkflowRuntime["runs"]>().not.toHaveProperty("getHandle");
    expectTypeOf<CloudflareWorkflowRuntime>().toExtend<WorkflowRuntime>();

    const step = createCloudflareStepApi({ step: new TestCloudflareStep() });
    expect(() => step.stream.create("unsupported")).toThrow(WorkflowCapabilityError);

    for (const api of [step.workflow, step.lock, step.runData, step.stream, step.hook]) {
      await expect(Promise.resolve(api)).resolves.toBe(api);
    }
  });
});

class TestCloudflareBinding implements CloudflareWorkflowBinding {
  readonly step = new TestCloudflareStep();
  createCount = 0;
  readonly #instances = new Map<string, TestCloudflareInstance>();
  readonly #registry: Registry;

  constructor(registry: Registry) {
    this.#registry = registry;
  }

  async create(
    options: CloudflareWorkflowInstanceCreateOptions = {},
  ): Promise<CloudflareWorkflowInstance> {
    this.createCount++;
    const id = options.id ?? crypto.randomUUID();

    if (this.#instances.has(id)) {
      throw new Error(`Duplicate instance: ${id}`);
    }

    const instance = new TestCloudflareInstance(id, options, this.#registry, this.step);
    this.#instances.set(id, instance);
    instance.start();

    return instance;
  }

  async createBatch(
    items: readonly CloudflareWorkflowInstanceCreateOptions[],
  ): Promise<readonly CloudflareWorkflowInstance[]> {
    const created: CloudflareWorkflowInstance[] = [];

    for (const item of items) {
      if (item.id !== undefined && this.#instances.has(item.id)) {
        continue;
      }

      created.push(await this.create(item));
    }

    return created;
  }

  async get(id: string): Promise<CloudflareWorkflowInstance> {
    const instance = this.#instances.get(id);

    if (instance === undefined) {
      throw new Error(`Instance not found: ${id}`);
    }

    return instance;
  }

  instance(id: string): TestCloudflareInstance {
    const instance = this.#instances.get(id);

    if (instance === undefined) {
      throw new Error(`Instance not found: ${id}`);
    }

    return instance;
  }
}

class TestCloudflareInstance implements CloudflareWorkflowInstance {
  readonly id: string;
  terminateCount = 0;
  #state: CloudflareWorkflowInstanceStatus = { status: "queued" };
  readonly #params: unknown;
  readonly #registry: Registry;
  readonly #step: TestCloudflareStep;

  constructor(
    id: string,
    options: CloudflareWorkflowInstanceCreateOptions,
    registry: Registry,
    step: TestCloudflareStep,
  ) {
    this.id = id;
    this.#params = options.params;
    this.#registry = registry;
    this.#step = step;
  }

  start(): void {
    this.#state = { status: "running" };

    const event: CloudflareWorkflowEvent = {
      payload: this.#params,
      timestamp: new Date(),
      instanceId: this.id,
      workflowName: "temelj",
    };

    void runCloudflareWorkflow({ registry: this.#registry }, event, this.#step).then(
      (output) => {
        this.#state = { status: "complete", output };
      },
      (cause: unknown) => {
        this.#state = {
          status: "errored",
          error: {
            name: cause instanceof Error ? cause.name : "Error",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        };
      },
    );
  }

  async status(): Promise<CloudflareWorkflowInstanceStatus> {
    return this.#state;
  }

  async terminate(): Promise<void> {
    this.terminateCount++;
    this.#state = { status: "terminated" };
  }

  async sendEvent(options: { readonly type: string; readonly payload?: unknown }): Promise<void> {
    this.#step.events.set(options.type, options.payload);
  }
}

class TestCloudflareStep implements CloudflareWorkflowStep {
  readonly configurations: CloudflareWorkflowStepConfig[] = [];
  readonly sleeps: { readonly name: string; readonly duration: number }[] = [];
  readonly waits: { readonly name: string; readonly type: string; readonly timeout: number }[] = [];
  readonly events = new Map<string, unknown>();
  readonly #counts = new Map<string, number>();

  async do<T>(
    name: string,
    config: CloudflareWorkflowStepConfig,
    callback: (context: CloudflareWorkflowStepContext) => T | Promise<T>,
  ): Promise<T> {
    this.configurations.push(config);
    const count = this.#nextCount(name);

    for (let attempt = 1; ; attempt++) {
      try {
        return await callback(testStepContext(name, attempt, count, config));
      } catch (error) {
        if (attempt > (config.retries?.limit ?? 5)) {
          throw error;
        }
      }
    }
  }

  async sleep(name: string, duration: number): Promise<void> {
    this.sleeps.push({ name, duration });
  }

  async sleepUntil(): Promise<void> {}

  async waitForEvent(
    name: string,
    options: { readonly type: string; readonly timeout: number },
  ): Promise<CloudflareWorkflowStepEvent> {
    this.waits.push({ name, type: options.type, timeout: Number(options.timeout) });

    while (!this.events.has(options.type)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    return {
      payload: this.events.get(options.type),
      timestamp: new Date(),
      type: options.type,
    };
  }

  #nextCount(name: string): number {
    const count = (this.#counts.get(name) ?? 0) + 1;
    this.#counts.set(name, count);

    return count;
  }
}

function testStepContext(
  name: string,
  attempt: number,
  count = 1,
  config: CloudflareWorkflowStepConfig = {},
): CloudflareWorkflowStepContext {
  return {
    step: { name, count },
    attempt,
    config,
  };
}
