import { describe, expect, test, vi } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { Registry } from "../../src/registry.ts";
import { WorkflowWorker } from "../../src/worker.ts";
import { waitFor } from "../utility.ts";

describe("workflow worker shutdown", () => {
  test("worker stop waits for active execution before releasing the lease", async () => {
    const now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_worker_stop_waits",
      now: () => now,
    });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });
    const firstWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stop_waits_a",
      leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });
    const def = defineWorkflow<undefined, string>({ name: "worker-stop-waits" });
    let workflowStarted!: () => void;
    const workflowStartedPromise = new Promise<void>((resolve) => {
      workflowStarted = resolve;
    });
    let finishExecution!: () => void;
    const executionCanFinish = new Promise<void>((resolve) => {
      finishExecution = resolve;
    });
    let stopReturned = false;

    client.implementWorkflow(def, async ({ signal }) => {
      workflowStarted();
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await executionCanFinish;
      throw signal.reason;
    });

    const handle = await client.runs.start(def, undefined);
    const execution = firstWorker.processNextRun();
    await workflowStartedPromise;

    const stop = firstWorker.stop().finally(() => {
      stopReturned = true;
    });
    await waitFor(async () => (await engine.getRun(handle.runId))?.status === "running");
    await Promise.resolve();

    expect(stopReturned).toBe(false);
    await expect(
      engine.store.claimRun({
        runId: handle.runId,
        workerId: "worker_stop_waits_b",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        now,
      }),
    ).resolves.toBeUndefined();

    finishExecution();

    await expect(stop).resolves.toBeUndefined();
    expect(stopReturned).toBe(true);
    await expect(execution).resolves.toMatchObject({
      kind: "waiting",
      run: {
        id: "run_worker_stop_waits",
        status: "waiting",
      },
    });
  });

  test("worker stop drain timeout leaves active leases for natural expiry", async () => {
    vi.useFakeTimers();
    try {
      const now = Temporal.Instant.from("2026-06-11T10:00:00Z");
      const engine = createWorkflowEngine({
        createRunId: () => "run_worker_stop_timeout",
        now: () => now,
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_stop_timeout_a",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
        stopDrainTimeout: Temporal.Duration.from({ milliseconds: 1 }),
        now: () => now,
      });
      const def = defineWorkflow<undefined, string>({ name: "worker-stop-timeout" });
      let workflowStarted!: () => void;
      const workflowStartedPromise = new Promise<void>((resolve) => {
        workflowStarted = resolve;
      });
      let finishExecution!: () => void;
      const executionCanFinish = new Promise<void>((resolve) => {
        finishExecution = resolve;
      });

      client.implementWorkflow(def, async () => {
        workflowStarted();
        await executionCanFinish;
        return "done";
      });

      const handle = await client.runs.start(def, undefined);
      const execution = worker.processNextRun();
      await vi.advanceTimersByTimeAsync(0);
      await workflowStartedPromise;

      const stop = worker.stop();
      await vi.advanceTimersByTimeAsync(1);
      await expect(stop).resolves.toBeUndefined();

      await expect(
        engine.store.claimRun({
          runId: handle.runId,
          workerId: "worker_stop_timeout_b",
          leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
          now,
        }),
      ).resolves.toBeUndefined();
      await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
        status: "running",
        workerId: "worker_stop_timeout_a",
      });

      finishExecution();
      await expect(execution).resolves.toMatchObject({
        kind: "completed",
        output: "done",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("worker stop aborts active workflow and step contexts", async () => {
    vi.useFakeTimers();
    try {
      const engine = createWorkflowEngine({
        createRunId: () => "run_worker_stop_abort",
        now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_stop_abort",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        heartbeatInterval: Temporal.Duration.from({ milliseconds: 1 }),
      });
      const def = defineWorkflow<undefined, string>({ name: "worker-stop-abort" });
      let stepStarted!: () => void;
      const stepStartedPromise = new Promise<void>((resolve) => {
        stepStarted = resolve;
      });
      let workflowSignalAborted = false;
      let stepSignalAborted = false;

      client.implementWorkflow(def, async ({ signal, step }) => {
        signal.addEventListener(
          "abort",
          () => {
            workflowSignalAborted = true;
          },
          { once: true },
        );
        await step.task.run(
          { name: "cancelable", retry: { maximumAttempts: 1 } },
          async (context) => {
            stepStarted();
            await new Promise<void>((resolve) => {
              context.signal.addEventListener(
                "abort",
                () => {
                  stepSignalAborted = true;
                  resolve();
                },
                { once: true },
              );
            });
            throw context.signal.reason;
          },
        );
        return "unreachable";
      });

      const handle = await client.runs.start(def, undefined);
      const execution = worker.processNextRun();
      await vi.advanceTimersByTimeAsync(0);
      await stepStartedPromise;

      await worker.stop();

      await expect(execution).resolves.toMatchObject({
        kind: "waiting",
        run: {
          id: "run_worker_stop_abort",
          status: "waiting",
        },
      });
      expect(workflowSignalAborted).toBe(true);
      expect(stepSignalAborted).toBe(true);
      await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
        status: "waiting",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
