import { describe, expect, test } from "vitest";

import type { WorkflowEngine } from "../engine/create.ts";
import type { StoreCapabilities, WorkflowStore } from "../types/store.ts";

import { createWorkflowClient } from "../client/create.ts";
import { createWorkflowEngine } from "../engine/create.ts";
import { WorkflowCapabilityError, WorkflowOptionsError } from "../errors/mod.ts";
import { Registry } from "../registry.ts";
import { WorkflowStore as DefaultStore } from "../store/create.ts";
import { WorkflowWorker } from "./worker.ts";

describe("workflow worker capabilities", () => {
  test("fails early when store coordination capabilities are missing", () => {
    const engine = createWorkflowEngine();
    const registry = new Registry();

    const weakEngine = workflowWorkerEngineWithCapabilities(engine, {
      ...engine.store.capabilities,
      conditionalRunClaims: false,
    });

    expect(
      () =>
        new WorkflowWorker({
          engine: weakEngine,
          registry,
        }),
    ).toThrow(WorkflowCapabilityError);
    expect(
      () =>
        new WorkflowWorker({
          engine: weakEngine,
          registry,
        }),
    ).toThrow("Workflow engine does not support workflow worker conditional run claims");
  });

  test("accepts the default in-memory store capabilities", () => {
    const engine = createWorkflowEngine();
    const registry = new Registry();

    expect(() => new WorkflowWorker({ engine, registry })).not.toThrow();
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid maxRuns value %s",
    async (maxRuns) => {
      const engine = createWorkflowEngine();
      const registry = new Registry();
      const worker = new WorkflowWorker({ engine, registry });

      await expect(worker.run({ maxRuns })).rejects.toThrow(WorkflowOptionsError);
      await worker.stop();
    },
  );

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid concurrency value %s",
    async (concurrency) => {
      const engine = createWorkflowEngine();
      const registry = new Registry();
      const worker = new WorkflowWorker({ engine, registry });

      await expect(worker.run({ concurrency })).rejects.toThrow(WorkflowOptionsError);
      await worker.stop();
    },
  );

  test("rejects invalid wakeDueRuns maxRuns values", async () => {
    const client = createWorkflowClient();

    await expect(client.workers.wakeDueRuns({ maxRuns: 0 })).rejects.toThrow(WorkflowOptionsError);
    await client.close();
  });
});

function workflowWorkerEngineWithCapabilities(
  engine: WorkflowEngine,
  capabilities: StoreCapabilities,
): WorkflowEngine {
  return createWorkflowEngine({
    store: workflowWorkerStoreWithCapabilities(engine.store, capabilities),
  });
}

function workflowWorkerStoreWithCapabilities(
  store: WorkflowStore,
  capabilities: StoreCapabilities,
): WorkflowStore {
  // Same storage and namespace, so the copy reads and writes the original store's records.
  class StoreWithCapabilities extends DefaultStore {
    override readonly capabilities = capabilities;
  }

  return new StoreWithCapabilities({ storage: store.storage, namespace: store.namespace });
}
