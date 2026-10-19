import { describe, expect, test, vi } from "vitest";

import type { RunRecord } from "../types/run.ts";
import type { ExtendRunLeaseOptions } from "../types/store.ts";

import { clientForEngine } from "../client/create.ts";
import { defineWorkflow } from "../definition.ts";
import { Registry } from "../registry.ts";
import { WorkflowStore } from "../store/create.ts";
import { waitFor } from "../testing/waiters.ts";
import { WorkflowWorker } from "../worker/worker.ts";
import { createWorkflowEngine } from "./create.ts";

type TestExtendRunLease = (options: ExtendRunLeaseOptions) => Promise<RunRecord | undefined>;

describe("workflow worker heartbeats", () => {
  test("worker heartbeats while a claimed run is executing", async () => {
    let now = Temporal.Instant.from("2026-06-07T10:00:00Z");

    const engine = createWorkflowEngine({
      now: () => now,
      createRunId: () => "run_heartbeat",
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_heartbeat",
      leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 1 }),
      now: () => now,
    });

    const def = defineWorkflow<undefined, string>({ name: "heartbeat" });

    client.implementWorkflow(def, async () => {
      now = Temporal.Instant.from("2026-06-07T10:00:30Z");
      await waitFor(async () => {
        const run = await engine.store.getRun("run_heartbeat");

        return (
          run?.leaseExpiresAt?.epochMilliseconds ===
          Temporal.Instant.from("2026-06-07T10:01:30Z").epochMilliseconds
        );
      });

      return "done";
    });

    const handle = await client.runs.start(def, undefined);
    await expect(worker.processNextRun()).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("done");
  });

  test("worker heartbeats do not make a running durable step stale", async () => {
    let now = Temporal.Instant.from("2026-06-07T10:00:00Z");

    const engine = createWorkflowEngine({
      now: () => now,
      createRunId: () => "run_heartbeat_step",
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_heartbeat_step",
      leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 1 }),
      now: () => now,
    });

    const def = defineWorkflow<undefined, string>({ name: "heartbeat-step" });

    client.implementWorkflow(def, async ({ step }) => {
      return await step.run({ name: "long task" }, async () => {
        now = Temporal.Instant.from("2026-06-07T10:00:30Z");
        await waitFor(async () => {
          const run = await engine.store.getRun("run_heartbeat_step");

          return (
            run?.leaseExpiresAt?.epochMilliseconds ===
            Temporal.Instant.from("2026-06-07T10:01:30Z").epochMilliseconds
          );
        });

        return "done";
      });
    });

    const handle = await client.runs.start(def, undefined);
    await expect(worker.processNextRun()).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("done");
  });

  test("worker waits for in-flight heartbeat before returning", async () => {
    let releaseHeartbeat!: () => void;

    const heartbeatCanFinish = new Promise<void>((resolve) => {
      releaseHeartbeat = resolve;
    });

    let heartbeatStarted = false;
    let workerReturned = false;
    const now = Temporal.Instant.from("2026-06-07T10:00:00Z");

    class DelayedHeartbeatStore extends WorkflowStore {
      constructor() {
        super();
        const extendRunLease: TestExtendRunLease = this.extendRunLease.bind(this);
        this.extendRunLease = async (options) => {
          heartbeatStarted = true;
          await heartbeatCanFinish;

          return await extendRunLease(options);
        };
      }
    }

    const store = new DelayedHeartbeatStore();

    const engine = createWorkflowEngine({
      store,
      createRunId: () => "run_heartbeat_awaited",
      now: () => now,
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_heartbeat_awaited",
      leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 1 }),
      now: () => now,
    });

    const def = defineWorkflow<undefined, string>({ name: "heartbeat-awaited" });
    client.implementWorkflow(def, async () => {
      await waitFor(async () => heartbeatStarted);

      return "done";
    });

    const handle = await client.runs.start(def, undefined);

    const execution = worker.processNextRun().finally(() => {
      workerReturned = true;
    });

    await waitFor(async () => heartbeatStarted);
    await Promise.resolve();
    expect(workerReturned).toBe(false);

    releaseHeartbeat();
    await expect(execution).resolves.toMatchObject({
      kind: "completed",
      output: "done",
      run: {
        id: "run_heartbeat_awaited",
        status: "completed",
      },
    });
    expect(workerReturned).toBe(true);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("done");
  });

  test("worker heartbeat aborts execution after lease ownership is lost", async () => {
    vi.useFakeTimers();

    try {
      let now = Temporal.Instant.from("2026-06-07T10:00:00Z");

      const engine = createWorkflowEngine({
        now: () => now,
        createRunId: () => "run_heartbeat_lost_lease",
      });

      const registry = new Registry();
      const client = clientForEngine(engine, { registry });

      const firstWorker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_heartbeat_lost_a",
        leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
        heartbeatInterval: Temporal.Duration.from({ milliseconds: 1 }),
        now: () => now,
      });

      const secondWorker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_heartbeat_lost_b",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        now: () => now,
      });

      const def = defineWorkflow<undefined, string>({ name: "heartbeat-lost-lease" });
      let executions = 0;

      client.implementWorkflow(def, async ({ signal }) => {
        executions++;

        if (executions === 1) {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          throw new DOMException("Workflow lease lost", "AbortError");
        }

        return "reclaimed";
      });

      const handle = await client.runs.start(def, undefined);
      const firstExecution = firstWorker.processNextRun();
      await vi.advanceTimersByTimeAsync(0);
      await expect(engine.store.getRun(handle.runId)).resolves.toMatchObject({
        status: "running",
        workerId: "worker_heartbeat_lost_a",
      });

      now = Temporal.Instant.from("2026-06-07T10:00:01Z");
      await expect(
        engine.store.claimRun({
          runId: handle.runId,
          workerId: "worker_heartbeat_lost_b",
          leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
          now,
        }),
      ).resolves.toMatchObject({
        workerId: "worker_heartbeat_lost_b",
      });

      await vi.advanceTimersByTimeAsync(1);

      await expect(firstExecution).resolves.toMatchObject({
        kind: "waiting",
        run: {
          id: "run_heartbeat_lost_lease",
          status: "running",
          workerId: "worker_heartbeat_lost_b",
          attempts: 2,
        },
      });
      expect(executions).toBe(1);
      await expect(secondWorker.releaseLease(handle.runId)).resolves.toMatchObject({
        status: "waiting",
        lastTransitionReason: "waiting",
      });
      await expect(secondWorker.processNextRun()).resolves.toMatchObject({
        kind: "completed",
        output: "reclaimed",
      });
      await expect(engine.store.getRun(handle.runId)).resolves.toMatchObject({
        status: "completed",
        output: "reclaimed",
      });
      expect(executions).toBe(2);
      await expect(
        handle.result({
          timeout: Temporal.Duration.from({ milliseconds: 0 }),
          pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        }),
      ).resolves.toBe("reclaimed");
    } finally {
      vi.useRealTimers();
    }
  });

  test("worker heartbeat aborts execution when lease extension rejects", async () => {
    vi.useFakeTimers();

    try {
      const now = Temporal.Instant.from("2026-06-11T10:00:00Z");

      class FailingHeartbeatStore extends WorkflowStore {
        constructor() {
          super();
          this.extendRunLease = async () => {
            throw new Error("heartbeat storage failed");
          };
        }
      }

      const engine = createWorkflowEngine({
        store: new FailingHeartbeatStore(),
        createRunId: () => "run_worker_heartbeat_reject",
        now: () => now,
      });

      const registry = new Registry();
      const client = clientForEngine(engine, { registry });

      const worker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_heartbeat_reject",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        heartbeatInterval: Temporal.Duration.from({ milliseconds: 1 }),
        now: () => now,
      });

      const def = defineWorkflow<undefined, string>({ name: "worker-heartbeat-reject" });
      let workflowSignalAborted = false;
      let workflowStarted!: () => void;

      const workflowStartedPromise = new Promise<void>((resolve) => {
        workflowStarted = resolve;
      });

      client.implementWorkflow(def, async ({ signal }) => {
        workflowStarted();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              workflowSignalAborted = true;
              resolve();
            },
            { once: true },
          );
        });

        return "unreachable";
      });

      await client.runs.start(def, undefined);
      const execution = worker.processNextRun();

      const executionError = execution.then(
        () => undefined,
        (cause: unknown) => cause,
      );

      await vi.advanceTimersByTimeAsync(0);
      await workflowStartedPromise;

      await vi.advanceTimersByTimeAsync(1);

      const error = await executionError;
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ message: "heartbeat storage failed" });
      expect(workflowSignalAborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
