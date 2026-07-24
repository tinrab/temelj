import type { Logger } from "@temelj/log";

import { createNoopLogger } from "@temelj/log";
import { describe, expect, expectTypeOf, test } from "vitest";

import type { RunTelemetryContext, Telemetry } from "../../src/types/telemetry.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";

describe("workflow telemetry", () => {
  test("runs without telemetry and with telemetry disabled", async () => {
    const noTelemetryEngine = createWorkflowEngine({ createRunId: () => "run-no-telemetry" });
    const disabledEngine = createWorkflowEngine({
      createRunId: () => "run-disabled-telemetry",
      telemetry: false,
    });
    const workflow = implementWorkflow({ name: "telemetry-disabled" }, () => "done");

    await expect(noTelemetryEngine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(disabledEngine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
  });

  test("wraps workflow and task execution and stores captured trace context", async () => {
    const runContexts: RunTelemetryContext[] = [];
    const stepNames: string[] = [];
    const telemetry: Telemetry = {
      captureContext: () => ({
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
      }),
      withRunExecution: async (context, callback) => {
        runContexts.push(context);
        return await callback();
      },
      withStepExecution: async (context, callback) => {
        stepNames.push(context.step.name);
        return await callback();
      },
    };
    const engine = createWorkflowEngine({
      createRunId: () => "run-telemetry-context",
      telemetry,
    });
    const workflow = implementWorkflow({ name: "telemetry-context" }, async ({ step }) => {
      return await step.task.run({ name: "work" }, () => "done");
    });

    const result = await engine.runWorkflowNow(workflow, undefined);
    const run = await engine.getRun("run-telemetry-context");

    expect(result).toMatchObject({ kind: "completed", output: "done" });
    expect(run?.telemetryContext).toEqual({
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    });
    expect(runContexts).toHaveLength(1);
    expect(runContexts[0]?.traceContext).toEqual(run?.telemetryContext);
    expect(runContexts[0]?.run).toMatchObject({
      attempts: 1,
      id: "run-telemetry-context",
      status: "running",
    });
    expect(stepNames).toEqual(["work"]);
  });

  test("uses claimed run ownership for workflow execution telemetry", async () => {
    const runContexts: RunTelemetryContext[] = [];
    const telemetry: Telemetry = {
      withRunExecution: async (context, callback) => {
        runContexts.push(context);
        return await callback();
      },
    };
    const engine = createWorkflowEngine({
      createRunId: () => "run-claimed-telemetry",
      now: () => Temporal.Instant.from("2026-06-15T10:00:00Z"),
      telemetry,
    });
    const workflow = implementWorkflow({ name: "claimed-telemetry" }, () => "done");

    await engine.runWorkflow(workflow, undefined);
    await expect(
      engine.store.claimRun({
        leaseDuration: Temporal.Duration.from({ minutes: 1 }),
        now: Temporal.Instant.from("2026-06-15T10:00:00Z"),
        runId: "run-claimed-telemetry",
        workerId: "worker_telemetry",
      }),
    ).resolves.toMatchObject({
      status: "running",
      workerId: "worker_telemetry",
    });

    const result = await engine.resumeWorkflow(workflow, "run-claimed-telemetry");

    expect(result).toMatchObject({ kind: "completed", output: "done" });
    expect(runContexts).toHaveLength(1);
    expect(runContexts[0]?.run).toMatchObject({
      attempts: 1,
      id: "run-claimed-telemetry",
      status: "running",
      workerId: "worker_telemetry",
    });
  });

  test("records step errors without swallowing workflow failure", async () => {
    const stepErrors: unknown[] = [];
    const telemetry: Telemetry = {
      withStepExecution: async (context, callback) => {
        try {
          return await callback();
        } catch (error) {
          stepErrors.push({ context, error });
          throw error;
        }
      },
    };
    const engine = createWorkflowEngine({
      createRunId: () => "run-step-error-telemetry",
      telemetry,
    });
    const error = new Error("task failed");
    const workflow = implementWorkflow({ name: "step-error-telemetry" }, async ({ step }) => {
      await step.task.run({ name: "explode" }, () => {
        throw error;
      });
    });

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result).toMatchObject({
      error: { message: "Workflow step failed: explode" },
      kind: "failed",
    });
    expect(stepErrors.length).toBeGreaterThan(0);
    expect(stepErrors[0]).toMatchObject({ error });
  });

  test("forwards observations after public subscribers and isolates telemetry failures", async () => {
    const order: string[] = [];
    const telemetry: Telemetry = {
      observe: (name) => {
        order.push(`telemetry:${name}`);
        throw new Error("telemetry observer failed");
      },
    };
    const engine = createWorkflowEngine({
      createRunId: () => "run-observed-telemetry",
      telemetry,
    });
    const workflow = implementWorkflow({ name: "observed-telemetry" }, () => "done");

    engine.on("workflow:*", (_, name) => {
      order.push(`listener:${name}`);
    });

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result).toMatchObject({ kind: "completed", output: "done" });
    expect(order.slice(0, 6)).toEqual([
      "listener:workflow:run-created",
      "telemetry:workflow:run-created",
      "listener:workflow:run-started",
      "telemetry:workflow:run-started",
      "listener:workflow:durable-event-appended",
      "telemetry:workflow:durable-event-appended",
    ]);
  });

  test("falls back to normal execution when a telemetry wrapper fails before callback", async () => {
    const telemetry: Telemetry = {
      withRunExecution: async () => {
        throw new Error("wrapper failed");
      },
    };
    const engine = createWorkflowEngine({
      createRunId: () => "run-wrapper-failure",
      telemetry,
    });
    const workflow = implementWorkflow({ name: "wrapper-failure" }, () => "done");

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
  });

  test("accepts OpenTelemetry workflow telemetry in engine options", async () => {
    const { createOpenTelemetryTelemetry } = await import("../../src/otel.ts");

    expectTypeOf(
      createWorkflowEngine({
        telemetry: createOpenTelemetryTelemetry(),
      }),
    ).toHaveProperty("runWorkflowNow");
  });

  test("engine close flushes logger resources and shuts down telemetry", async () => {
    const order: string[] = [];
    const logger = createNoopLogger().child({});
    const closingLogger: Logger = {
      ...logger,
      close: async () => {
        order.push("logger");
      },
    };
    const telemetry: Telemetry = {
      shutdown: async () => {
        order.push("telemetry");
      },
    };
    const engine = createWorkflowEngine({ logger: closingLogger, telemetry });

    await engine.close();

    expect(order).toEqual(["logger", "telemetry"]);
  });

  test("client close delegates to engines that support close", async () => {
    let closed = false;
    const engine = createWorkflowEngine();
    const client = createWorkflowClient({
      engine: {
        ...engine,
        close: async () => {
          closed = true;
        },
      },
    });

    await client.close();

    expect(closed).toBe(true);
  });
});
