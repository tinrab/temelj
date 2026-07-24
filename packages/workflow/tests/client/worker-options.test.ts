import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { workerOptionsFromClientOptions } from "../../src/client/worker-options.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { Registry } from "../../src/registry.ts";
import { withoutWorkflowWorkerStore } from "../support/client-engine.ts";

describe("workflow client worker options", () => {
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

  test("uses an explicit worker engine for client worker operations", () => {
    const engine = createWorkflowEngine();
    const clientOnlyEngine = withoutWorkflowWorkerStore(engine);
    const client = createWorkflowClient({
      engine: clientOnlyEngine,
      workerEngine: engine,
    });

    expect(client.workers.create()).toBeDefined();
  });
});
