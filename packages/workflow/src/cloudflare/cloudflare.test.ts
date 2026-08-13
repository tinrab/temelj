import { describe, expect, test } from "vitest";

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
import { implementWorkflow } from "../definition.ts";
import { WorkflowCapabilityError } from "../errors/mod.ts";
import { runCloudflareWorkflow } from "./execution.ts";
import { createCloudflareWorkflowHost } from "./host.ts";
import { createCloudflareWorkflowRegistry } from "./registry.ts";
import { createCloudflareWorkflowRuntime } from "./runtime.ts";

describe("Cloudflare Workflow adapter", () => {
  test("creates a static Cloudflare host from a workflow bundle", async () => {
    const workflow = implementWorkflow<number, number>(
      { name: "cloudflare-host" },
      ({ input }) => input * 2,
    );
    const host = createCloudflareWorkflowHost({
      workflows: defineWorkflowBundle([workflow]),
    });
    const binding = new TestCloudflareBinding(createCloudflareWorkflowRegistry([workflow]));
    const runtime = host.createRuntime(binding);

    const handle = await runtime.start(workflow, 21, { id: "host-1" });

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
    const binding = new TestCloudflareBinding(createCloudflareWorkflowRegistry([bundled]));
    const runtime = host.createRuntime(binding);

    await expect(runtime.start(omitted, undefined)).rejects.toThrow(
      "Workflow implementation is not included in the workflow bundle: cloudflare-omitted",
    );
    expect(binding.createCount).toBe(0);
  });

  test("runs Temelj tasks, sleeps, deterministic commands, and results through Cloudflare", async () => {
    const workflow = implementWorkflow<{ readonly value: number }, number>(
      { name: "cloudflare-core" },
      async ({ input, step }) => {
        const random = await step.deterministic.random("seed");
        const value = await step.task.run(
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
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        return value + random;
      },
    );
    const registry = createCloudflareWorkflowRegistry([workflow]);
    const binding = new TestCloudflareBinding(registry);
    const runtime = createCloudflareWorkflowRuntime({ binding, registry });

    const handle = await runtime.start(workflow, { value: 20 }, { id: "core-1" });

    const result = await handle.result();
    expect(result).toBeGreaterThanOrEqual(40);
    expect(result).toBeLessThan(41);
    await expect(handle.status()).resolves.toBe("completed");
    expect(binding.step.sleeps).toHaveLength(1);
    expect(binding.step.sleeps[0]?.duration).toBe(1_000);
    expect(binding.step.sleeps[0]?.name).toMatch(/^pause-[a-z0-9]+$/);
    expect(binding.step.configurations[1]?.retries?.limit).toBe(3);
    const delay = binding.step.configurations[1]?.retries?.delay;
    if (typeof delay !== "function") {
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
        await step.message.wait<{ readonly approved: boolean }>({
          messageId: "approval.received",
          timeout: Temporal.Duration.from({ minutes: 5 }),
        }),
    );
    const registry = createCloudflareWorkflowRegistry([workflow]);
    const binding = new TestCloudflareBinding(registry);
    const runtime = createCloudflareWorkflowRuntime({ binding, registry });

    const handle = await runtime.start(workflow, undefined, { id: "message-1" });
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
        await step.task.run(
          {
            name: "unbounded",
            retry: { maximumAttempts: 0 },
          },
          () => undefined,
        );
      },
    );
    const registry = createCloudflareWorkflowRegistry([workflow]);
    const runtime = createCloudflareWorkflowRuntime({
      binding: new TestCloudflareBinding(registry),
      registry,
    });

    const handle = await runtime.start(workflow, undefined, { id: "limits-1" });
    await expect(handle.result()).rejects.toThrow(
      "Cloudflare Workflow steps support at most 10000 attempts",
    );
  });

  test("rejects step timeouts longer than Cloudflare's 30 minute limit", async () => {
    const workflow = implementWorkflow<undefined, void>(
      { name: "cloudflare-timeout-limit" },
      async ({ step }) => {
        await step.task.run(
          {
            name: "too-long",
            timeout: Temporal.Duration.from({ minutes: 31 }),
          },
          () => undefined,
        );
      },
    );
    const registry = createCloudflareWorkflowRegistry([workflow]);
    const runtime = createCloudflareWorkflowRuntime({
      binding: new TestCloudflareBinding(registry),
      registry,
    });

    const handle = await runtime.start(workflow, undefined, { id: "timeout-limit-1" });
    await expect(handle.result()).rejects.toThrow(
      "Cloudflare Workflow step timeout must not exceed 1800000 milliseconds",
    );
  });

  test("cancel is idempotent after a run reaches a terminal state", async () => {
    const workflow = implementWorkflow<undefined, string>(
      { name: "cloudflare-cancel" },
      () => "done",
    );
    const registry = createCloudflareWorkflowRegistry([workflow]);
    const binding = new TestCloudflareBinding(registry);
    const runtime = createCloudflareWorkflowRuntime({ binding, registry });
    const handle = await runtime.start(workflow, undefined, { id: "cancel-1" });

    await expect(handle.result()).resolves.toBe("done");
    await expect(handle.cancel()).resolves.toMatchObject({ status: "completed" });
    expect(binding.instance("cancel-1").terminateCount).toBe(0);
  });

  test("keeps the full runtime shape and reports unsupported capabilities", async () => {
    const registry = createCloudflareWorkflowRegistry();
    const runtime = createCloudflareWorkflowRuntime({
      binding: new TestCloudflareBinding(registry),
      registry,
    });

    expect(() => runtime.locks.list()).toThrow(WorkflowCapabilityError);
    await expect(runtime.runs.getHandle("missing")).rejects.toThrow(WorkflowCapabilityError);
  });
});

class TestCloudflareBinding implements CloudflareWorkflowBinding {
  readonly step = new TestCloudflareStep();
  createCount = 0;
  readonly #instances = new Map<string, TestCloudflareInstance>();
  readonly #registry: ReturnType<typeof createCloudflareWorkflowRegistry>;

  constructor(registry: ReturnType<typeof createCloudflareWorkflowRegistry>) {
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
    const instance = new TestCloudflareInstance(id, options.params, this.#registry, this.step);
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
  readonly #registry: ReturnType<typeof createCloudflareWorkflowRegistry>;
  readonly #step: TestCloudflareStep;

  constructor(
    id: string,
    params: unknown,
    registry: ReturnType<typeof createCloudflareWorkflowRegistry>,
    step: TestCloudflareStep,
  ) {
    this.id = id;
    this.#params = params;
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
      (error: unknown) => {
        this.#state = {
          status: "errored",
          error: {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
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
    return await callback(testStepContext(name, 1, this.#nextCount(name), config));
  }

  async sleep(name: string, duration: number): Promise<void> {
    this.sleeps.push({ name, duration });
  }

  async sleepUntil(): Promise<void> {}

  async waitForEvent<T>(
    name: string,
    options: { readonly type: string; readonly timeout: string | number },
  ): Promise<CloudflareWorkflowStepEvent<T>> {
    this.waits.push({ name, type: options.type, timeout: Number(options.timeout) });
    while (!this.events.has(options.type)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return {
      payload: this.events.get(options.type) as T,
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
