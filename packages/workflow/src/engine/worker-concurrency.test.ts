import { describe, expect, test } from "vitest";

import type { RunRecord } from "../types/run.ts";
import type { ClaimRunOptions } from "../types/store.ts";

import { clientForEngine } from "../client/create.ts";
import { defineWorkflow } from "../definition.ts";
import { Registry } from "../registry.ts";
import { WorkflowStore } from "../store/create.ts";
import { sequentialRunIds } from "../testing/helpers.ts";
import { waitFor } from "../testing/waiters.ts";
import { WorkflowWorker } from "../worker/worker.ts";
import { createWorkflowEngine } from "./create.ts";

type TestClaimRun = (options: ClaimRunOptions) => Promise<RunRecord | undefined>;

describe("workflow worker concurrency", () => {
  test("multiple workers split due runs without duplicate claims", async () => {
    let releaseBoth!: () => void;

    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });

    let activeRuns = 0;

    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds(
        "run_multi_worker_contention_first",
        "run_multi_worker_contention_second",
      ),
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const firstWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_contention_a",
    });

    const secondWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_contention_b",
    });

    const def = defineWorkflow<string, string>({ name: "multi-worker-contention" });

    client.implementWorkflow(def, async ({ input }) => {
      activeRuns++;

      if (activeRuns === 2) {
        releaseBoth();
      }

      await bothStarted;
      activeRuns--;

      return input;
    });

    const first = await client.runs.start(def, "first");
    const second = await client.runs.start(def, "second");

    const firstExecution = firstWorker.processNextRun({ workflowName: "multi-worker-contention" });
    await waitFor(async () => {
      const run = await engine.store.getRun(first.runId);

      return run?.workerId === "worker_contention_a";
    });

    const results = await Promise.all([
      firstExecution,
      secondWorker.processNextRun({ workflowName: "multi-worker-contention" }),
    ]);

    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "completed",
          output: "first",
          run: expect.objectContaining({ id: "run_multi_worker_contention_first" }),
        }),
        expect.objectContaining({
          kind: "completed",
          output: "second",
          run: expect.objectContaining({ id: "run_multi_worker_contention_second" }),
        }),
      ]),
    );
    await expect(
      first.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("first");
    await expect(
      second.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("second");
  });

  test("competing workers leave one winner for a single due run", async () => {
    let releaseWorkflow!: () => void;

    const workflowCanFinish = new Promise<void>((resolve) => {
      releaseWorkflow = resolve;
    });

    let executions = 0;

    const engine = createWorkflowEngine({
      createRunId: () => "run_single_worker_contention",
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const firstWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_single_contention_a",
    });

    const secondWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_single_contention_b",
    });

    const def = defineWorkflow<undefined, string>({ name: "single-worker-contention" });

    client.implementWorkflow(def, async () => {
      executions++;
      await workflowCanFinish;

      return "done";
    });

    const handle = await client.runs.start(def, undefined);

    const firstExecution = firstWorker.processNextRun({
      workflowName: "single-worker-contention",
    });

    await waitFor(async () => {
      const run = await engine.store.getRun(handle.runId);

      return run?.workerId === "worker_single_contention_a";
    });
    await expect(
      secondWorker.processNextRun({ workflowName: "single-worker-contention" }),
    ).resolves.toBeUndefined();

    releaseWorkflow();
    await expect(firstExecution).resolves.toMatchObject({
      kind: "completed",
      output: "done",
      run: {
        id: "run_single_worker_contention",
      },
    });
    expect(executions).toBe(1);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("done");
  });

  test("worker run processes claimed runs concurrently", async () => {
    let releaseBoth!: () => void;

    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });

    let activeRuns = 0;
    let maxActiveRuns = 0;

    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_concurrent_worker_first", "run_concurrent_worker_second"),
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_concurrent",
    });

    const def = defineWorkflow<string, string>({ name: "concurrent-worker" });

    client.implementWorkflow(def, async ({ input }) => {
      activeRuns++;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);

      if (activeRuns === 2) {
        releaseBoth();
      }

      await bothStarted;
      activeRuns--;

      return input;
    });

    const first = await client.runs.start(def, "first");
    const second = await client.runs.start(def, "second");

    await expect(
      worker.run({
        concurrency: 2,
        maxRuns: 2,
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toEqual({
      processedRuns: 2,
    });
    expect(maxActiveRuns).toBe(2);
    await expect(
      first.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("first");
    await expect(
      second.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("second");
  });

  test("worker run sleeps when concurrency is partially idle", async () => {
    let claimAttempts = 0;
    let releaseWorkflow!: () => void;

    const workflowCanFinish = new Promise<void>((resolve) => {
      releaseWorkflow = resolve;
    });

    class CountingClaimStore extends WorkflowStore {
      constructor() {
        super();
        const claimRun: TestClaimRun = this.claimRun.bind(this);
        this.claimRun = async (options) => {
          claimAttempts++;

          return await claimRun(options);
        };
      }
    }

    const engine = createWorkflowEngine({
      createRunId: () => "run_partially_idle_worker",
      store: new CountingClaimStore(),
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_partially_idle",
    });

    const def = defineWorkflow<undefined, string>({ name: "partially-idle-worker" });
    client.implementWorkflow(def, async () => {
      await workflowCanFinish;

      return "done";
    });
    const handle = await client.runs.start(def, undefined);

    const run = worker.run({
      concurrency: 2,
      maxRuns: 2,
      pollInterval: Temporal.Duration.from({ milliseconds: 10_000 }),
    });

    await waitFor(async () => claimAttempts >= 2);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(claimAttempts).toBe(2);
    releaseWorkflow();
    await worker.stop();
    await expect(run).resolves.toEqual({ processedRuns: 1 });
    await expect(engine.store.getRun(handle.runId)).resolves.toMatchObject({
      status: "completed",
      output: "done",
    });
  });
});
