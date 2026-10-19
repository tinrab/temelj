import { describe, expect, test } from "vitest";

import { createWorkflowEngine } from "../engine/create.ts";
import { Registry } from "../registry.ts";
import { workerOptionsFromClientOptions } from "./worker-options.ts";

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
});
