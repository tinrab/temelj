import { describe, expect, test } from "vitest";

import type { RunId } from "../types/ids.ts";
import type { RunRecord } from "../types/run.ts";

import { clientForEngine } from "../client/create.ts";
import { implementWorkflow, defineWorkflow } from "../definition.ts";
import { Registry } from "../registry.ts";
import { WorkflowStore } from "../store/create.ts";
import { sequentialRunIds } from "../testing/helpers.ts";
import { waitFor } from "../testing/waiters.ts";
import { WorkflowWorker } from "../worker/worker.ts";
import { createWorkflowEngine } from "./create.ts";

type WorkflowTestUpdateRunIfCurrent = (
  current: RunRecord,
  next: RunRecord,
) => Promise<RunRecord | undefined>;

describe("stale workflow executions", () => {
  test("stale worker executions do not append sleep events after reclaim", async () => {
    let now = Temporal.Instant.from("2026-06-07T10:00:00Z");

    const engine = createWorkflowEngine({
      createRunId: () => "run_stale_sleep_append",
      now: () => now,
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const firstWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stale_sleep_a",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });

    const secondWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stale_sleep_b",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });

    const def = defineWorkflow<undefined, string>({ name: "stale-sleep-append" });
    let executions = 0;
    let finishFirstExecution!: () => void;

    const firstExecutionCanContinue = new Promise<void>((resolve) => {
      finishFirstExecution = resolve;
    });

    client.implementWorkflow(def, async ({ step }) => {
      executions++;
      const execution = executions;

      if (execution === 1) {
        await firstExecutionCanContinue;
      }

      if (execution === 1) {
        await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));

        return "stale";
      }

      return "fresh";
    });

    const handle = await client.runs.start(def);
    const firstExecution = firstWorker.processNextRun();

    await waitFor(async () => {
      const run = await engine.store.getRun("run_stale_sleep_append");

      return run?.workerId === "worker_stale_sleep_a";
    });

    now = Temporal.Instant.from("2026-06-07T10:00:01Z");
    await expect(secondWorker.processNextRun()).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_sleep_append",
        status: "completed",
        attempts: 2,
      },
    });

    finishFirstExecution();
    await expect(firstExecution).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_sleep_append",
        status: "completed",
        attempts: 2,
      },
    });

    expect(
      (await engine.store.getEvents("run_stale_sleep_append")).filter(
        (event) => event.kind === "sleep_started" || event.kind === "sleep_completed",
      ),
    ).toEqual([]);
    expect(await engine.store.getRun("run_stale_sleep_append")).toMatchObject({
      status: "completed",
      output: "fresh",
    });
    expect(await engine.store.listStepAttempts("run_stale_sleep_append")).toEqual([]);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("fresh");
  });

  test("stale worker executions do not append message-send events after reclaim", async () => {
    let now = Temporal.Instant.from("2026-06-07T10:00:00Z");

    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_stale_message_target", "run_stale_message_append"),
      now: () => now,
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const firstWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stale_message_a",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });

    const secondWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stale_message_b",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });

    const target = implementWorkflow({ name: "stale-message-target" }, () => "target");

    const def = defineWorkflow<{ readonly targetRunId: RunId }, string>({
      name: "stale-message-append",
    });

    let executions = 0;
    let finishFirstExecution!: () => void;

    const firstExecutionCanContinue = new Promise<void>((resolve) => {
      finishFirstExecution = resolve;
    });

    client.implementWorkflow(def, async ({ input, step }) => {
      executions++;
      const execution = executions;

      if (execution === 1) {
        await firstExecutionCanContinue;
      }

      if (execution === 1) {
        await step.message.send(input.targetRunId, {
          messageId: "message",
          payload: { message: "stale" },
        });

        return "stale";
      }

      return "fresh";
    });

    const targetHandle = await engine.startWorkflow(target, undefined);
    const handle = await client.runs.start(def, { targetRunId: targetHandle.runId });
    const firstExecution = firstWorker.processRun(handle.runId);

    await waitFor(async () => {
      const run = await engine.store.getRun("run_stale_message_append");

      return run?.workerId === "worker_stale_message_a";
    });

    now = Temporal.Instant.from("2026-06-07T10:00:01Z");
    await expect(secondWorker.processRun(handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_message_append",
        status: "completed",
        attempts: 2,
      },
    });

    finishFirstExecution();
    await expect(firstExecution).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_message_append",
        status: "completed",
        attempts: 2,
      },
    });

    expect(
      (await engine.store.getEvents("run_stale_message_append")).filter(
        (event) =>
          event.kind === "message_send_started" ||
          event.kind === "message_send_completed" ||
          event.kind === "message_send_failed",
      ),
    ).toEqual([]);
    expect(
      (await engine.store.getEvents(targetHandle.runId)).filter(
        (event) => event.kind === "message_sent",
      ),
    ).toEqual([]);
    expect(await engine.store.listStepAttempts("run_stale_message_append")).toEqual([]);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("fresh");
  });

  test("stale worker executions do not append message-wait events after reclaim", async () => {
    let now = Temporal.Instant.from("2026-06-07T10:00:00Z");

    const engine = createWorkflowEngine({
      createRunId: () => "run_stale_message_wait_append",
      now: () => now,
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const firstWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stale_message_wait_a",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });

    const secondWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stale_message_wait_b",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });

    const def = defineWorkflow<undefined, string>({ name: "stale-message-wait-append" });
    let executions = 0;
    let finishFirstExecution!: () => void;

    const firstExecutionCanContinue = new Promise<void>((resolve) => {
      finishFirstExecution = resolve;
    });

    client.implementWorkflow(def, async ({ step }) => {
      executions++;
      const execution = executions;

      if (execution === 1) {
        await firstExecutionCanContinue;
      }

      if (execution === 1) {
        await step.message.wait({
          name: "message",
          messageId: "message",
          timeout: Temporal.Duration.from({ hours: 1 }),
        });

        return "stale";
      }

      return "fresh";
    });

    const handle = await client.runs.start(def);
    const firstExecution = firstWorker.processRun(handle.runId);

    await waitFor(async () => {
      const run = await engine.store.getRun("run_stale_message_wait_append");

      return run?.workerId === "worker_stale_message_wait_a";
    });

    now = Temporal.Instant.from("2026-06-07T10:00:01Z");
    await expect(secondWorker.processRun(handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_message_wait_append",
        status: "completed",
        attempts: 2,
      },
    });

    finishFirstExecution();
    await expect(firstExecution).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_message_wait_append",
        status: "completed",
        attempts: 2,
      },
    });

    expect(
      (await engine.store.getEvents("run_stale_message_wait_append")).filter(
        (event) =>
          event.kind === "message_wait_started" ||
          event.kind === "message_wait_completed" ||
          event.kind === "message_wait_failed",
      ),
    ).toEqual([]);
    expect(await engine.store.getRun("run_stale_message_wait_append")).toMatchObject({
      status: "completed",
      output: "fresh",
    });
    expect(await engine.store.listStepAttempts("run_stale_message_wait_append")).toEqual([]);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("fresh");
  });

  test("stale missing-implementation workers do not overwrite reclaimed runs", async () => {
    let now = Temporal.Instant.from("2026-06-07T10:00:00Z");
    let staleUpdateStarted!: () => void;
    let releaseStaleUpdate!: () => void;
    let delayNextMissingImplementationUpdate = true;

    const staleUpdateWasStarted = new Promise<void>((resolve) => {
      staleUpdateStarted = resolve;
    });

    const staleUpdateCanContinue = new Promise<void>((resolve) => {
      releaseStaleUpdate = resolve;
    });

    class DelayedMissingImplementationStore extends WorkflowStore {
      constructor() {
        super();

        const updateRunIfCurrent: WorkflowTestUpdateRunIfCurrent =
          this.updateRunIfCurrent.bind(this);

        this.updateRunIfCurrent = async (current, next) => {
          if (
            delayNextMissingImplementationUpdate &&
            next.lastTransitionReason === "missing_implementation"
          ) {
            delayNextMissingImplementationUpdate = false;
            staleUpdateStarted();
            await staleUpdateCanContinue;
          }

          return await updateRunIfCurrent(current, next);
        };
      }
    }

    const store = new DelayedMissingImplementationStore();

    const engine = createWorkflowEngine({
      store,
      now: () => now,
      createRunId: () => "run_stale_missing_implementation",
    });

    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const firstWorker = new WorkflowWorker({
      engine,
      registry: new Registry(),
      workerId: "worker_missing_a",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });

    const secondWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_missing_b",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });

    const def = defineWorkflow<undefined, string>({
      name: "stale-missing-implementation",
    });

    client.implementWorkflow(def, () => "fresh");

    const handle = await client.runs.start(def, undefined);
    const firstExecution = firstWorker.processNextRun();

    await staleUpdateWasStarted;
    now = Temporal.Instant.from("2026-06-07T10:00:01Z");
    await expect(secondWorker.processNextRun()).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_missing_implementation",
        status: "completed",
        attempts: 2,
      },
    });

    releaseStaleUpdate();
    await expect(firstExecution).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_missing_implementation",
        status: "completed",
        attempts: 2,
      },
    });
    expect(await engine.store.getRun("run_stale_missing_implementation")).toMatchObject({
      status: "completed",
      attempts: 2,
      output: "fresh",
      finishedAt: Temporal.Instant.from("2026-06-07T10:00:01Z"),
    });
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("fresh");
  });
});
