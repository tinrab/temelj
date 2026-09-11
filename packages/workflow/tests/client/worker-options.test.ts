import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { workerOptionsFromClientOptions } from "../../src/client/worker-options.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { Registry } from "../../src/registry.ts";
import { withoutWorkflowWorkerStore } from "../support/client-engine.ts";

describe("workflow client worker options", () => {
  test("does not infer worker support from unrelated adapter methods", async () => {
    const engine = createWorkflowEngine();
    const clientOnlyEngine = withoutWorkflowWorkerStore(engine);
    const client = createWorkflowClient({ engine: clientOnlyEngine });
    const definition = defineWorkflow<undefined, string>({ name: "client-no-worker" });
    client.implementWorkflow(definition, () => "done");
    const handle = await client.runs.start(definition, undefined);

    await expect(client.workers.processRun(handle.runId)).rejects.toThrow("worker");
    await expect(handle.status()).resolves.toBe("pending");
    await client.close();
  });

  test("uses the worker capability exposed by its engine", async () => {
    const engine = createWorkflowEngine();
    expect(engine.workerEngine).toBe(engine);
    const client = createWorkflowClient({ engine });
    const definition = defineWorkflow<undefined, string>({ name: "client-engine-worker" });
    client.implementWorkflow(definition, () => "done");
    const handle = await client.runs.start(definition, undefined);

    await client.workers.processRun(handle.runId);
    await expect(handle.result()).resolves.toBe("done");
    await client.close();
  });

  test("preserves worker polling options when creating worker constructor options", () => {
    const engine = createWorkflowEngine();
    const registry = new Registry();
    const now = () => Temporal.Instant.from("2026-06-17T10:00:00Z");
    const pollInterval = Temporal.Duration.from({ seconds: 5 });

    expect(
      workerOptionsFromClientOptions(engine, registry, now, {
        workerId: "worker-options",
        pollInterval,
      }),
    ).toMatchObject({
      engine,
      registry,
      now,
      workerId: "worker-options",
      pollInterval,
    });
  });

  test("uses an explicit worker engine for client worker operations", async () => {
    const engine = createWorkflowEngine();
    const clientOnlyEngine = withoutWorkflowWorkerStore(engine);

    const client = createWorkflowClient({
      engine: clientOnlyEngine,
      workerEngine: engine,
    });

    const definition = defineWorkflow<undefined, string>({ name: "client-only-adapter" });
    client.implementWorkflow(definition, () => "done");
    const handle = await client.runs.start(definition, undefined);

    await expect(handle.status()).resolves.toBe("pending");
    await client.workers.processRun(handle.runId);
    await expect(handle.status()).resolves.toBe("completed");
    await expect(handle.result()).resolves.toBe("done");
    await client.close();
  });
});
