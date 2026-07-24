import { describe, expect, test } from "vitest";

import type { WorkflowWorkerEngine, WorkflowWorkerEngineStore } from "../src/types/engine.ts";
import type { WorkflowStoreCapabilities } from "../src/types/store.ts";

import { createWorkflowClient } from "../src/client/create.ts";
import { createWorkflowEngine } from "../src/engine/create.ts";
import { WorkflowCapabilityError, WorkflowOptionsError } from "../src/errors/mod.ts";
import { Registry } from "../src/registry.ts";
import { WorkflowWorker } from "../src/worker.ts";

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
  engine: WorkflowWorkerEngine,
  capabilities: WorkflowStoreCapabilities,
): WorkflowWorkerEngine {
  return {
    store: workflowWorkerStoreWithCapabilities(engine.store, capabilities),
    resumeWorkflow: (implementation, runId, options) =>
      engine.resumeWorkflow(implementation, runId, options),
    getRun: (runId) => engine.getRun(runId),
    getRunSummary: (options) => engine.getRunSummary(options),
    listSchedules: (options) => engine.listSchedules(options),
    tickSchedules: (options) => engine.tickSchedules(options),
    observeWorkerOperation: (event) => engine.observeWorkerOperation?.(event),
  };
}

function workflowWorkerStoreWithCapabilities(
  store: WorkflowWorkerEngineStore,
  capabilities: WorkflowStoreCapabilities,
): WorkflowWorkerEngineStore {
  return {
    capabilities,
    claimRun: (options) => store.claimRun(options),
    extendRunLease: (options) => store.extendRunLease(options),
    releaseRunLease: (options) => store.releaseRunLease(options),
    getRun: (runId) => store.getRun(runId),
    updateRun: (run) => store.updateRun(run),
    updateRunIfCurrent: (current, next) => store.updateRunIfCurrent(current, next),
    appendEventIfRunCurrent: (current, event) => store.appendEventIfRunCurrent(current, event),
    getEvents: (runId) => store.getEvents(runId),
    listStepAttempts: (runId, options) => store.listStepAttempts(runId, options),
  };
}
