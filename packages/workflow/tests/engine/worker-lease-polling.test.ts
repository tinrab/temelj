import { describe, expect, test, vi } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import {
  WorkflowImplementationNotFoundError,
  WorkflowResultTimeoutError,
} from "../../src/errors/mod.ts";
import { Registry } from "../../src/registry.ts";
import { makeRunKey } from "../../src/store-keys.ts";
import { WorkflowWorker } from "../../src/worker.ts";
import { runRecordStorageValue } from "../support/storage-values.ts";
import { createHiddenFirstRunScanStorage, sequentialRunIds } from "../utility.ts";

describe("workflow worker lease polling", () => {
  test("worker polling uses exact stored workflow version", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_worker_exact_version",
    });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });
    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_exact_version",
      missingImplementationRetry: { maximumAttempts: 1 },
    });
    const versionOne = defineWorkflow<undefined, string>({
      name: "worker-exact-version",
      version: "1",
    });
    const versionTwo = defineWorkflow<undefined, string>({
      name: "worker-exact-version",
      version: "2",
    });

    client.implementWorkflow(versionTwo, () => "v2");
    const handle = await client.runs.start(versionOne, undefined);

    await expect(worker.processNextRun()).resolves.toMatchObject({
      kind: "failed",
      run: {
        workflowName: "worker-exact-version",
        workflowVersion: "1",
        status: "failed",
      },
      error: { name: "WorkflowImplementationNotFoundError" },
    });
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toBeInstanceOf(WorkflowImplementationNotFoundError);
  });

  test("worker polling wakes at the next expired lease before the poll interval", async () => {
    vi.useFakeTimers();
    try {
      let now = Temporal.Instant.from("2026-06-07T10:00:00Z");
      const engine = createWorkflowEngine({
        now: () => now,
        createRunId: () => "run_lease_wakeup",
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_lease_wakeup_b",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        now: () => now,
        pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
      });
      const def = defineWorkflow<undefined, string>({ name: "lease-wakeup" });
      client.implementWorkflow(def, () => "reclaimed");

      const handle = await client.runs.start(def, undefined);
      await engine.store.claimRun({
        runId: handle.runId,
        workerId: "worker_lease_wakeup_a",
        leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
        now,
      });
      const loop = worker.run({ maxRuns: 1 });

      await vi.advanceTimersByTimeAsync(999);
      await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
        status: "running",
        workerId: "worker_lease_wakeup_a",
        leaseExpiresAt: Temporal.Instant.from("2026-06-07T10:00:01Z"),
      });

      now = Temporal.Instant.from("2026-06-07T10:00:01Z");
      await vi.advanceTimersByTimeAsync(1);

      await expect(loop).resolves.toEqual({ processedRuns: 1 });
      await expect(
        handle.result({
          timeout: Temporal.Duration.from({ milliseconds: 0 }),
          pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        }),
      ).resolves.toBe("reclaimed");
      await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
        status: "completed",
        attempts: 2,
      });
      await expect(engine.getRun(handle.runId)).resolves.not.toHaveProperty("workerId");
    } finally {
      vi.useRealTimers();
    }
  });

  test("worker polling wakes immediately for missing stale lease timestamps", async () => {
    vi.useFakeTimers();
    try {
      const now = Temporal.Instant.from("2026-06-07T10:00:00Z");
      const storage = createHiddenFirstRunScanStorage();
      const engine = createWorkflowEngine({
        storage,
        now: () => now,
        createRunId: () => "run_missing_lease_wakeup",
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_missing_lease_wakeup_b",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        now: () => now,
        pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
      });
      const def = defineWorkflow<undefined, string>({ name: "missing-lease-wakeup" });
      client.implementWorkflow(def, () => "reclaimed");

      const handle = await client.runs.start(def, undefined);
      const firstClaim = await engine.store.claimRun({
        runId: handle.runId,
        workerId: "worker_missing_lease_wakeup_a",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        now,
      });
      if (firstClaim === undefined) {
        throw new Error("Expected initial claim");
      }
      const { leaseExpiresAt: _leaseExpiresAt, ...missingLeaseRun } = firstClaim;
      await storage.set(
        makeRunKey("default", firstClaim.id),
        runRecordStorageValue(missingLeaseRun),
      );

      const loop = worker.run({ maxRuns: 1 });
      await vi.advanceTimersByTimeAsync(0);

      await expect(loop).resolves.toEqual({ processedRuns: 1 });
      await expect(
        handle.result({
          timeout: Temporal.Duration.from({ milliseconds: 0 }),
          pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        }),
      ).resolves.toBe("reclaimed");
      await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
        status: "completed",
        attempts: 2,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("worker polling wakes immediately for ownerless future lease timestamps", async () => {
    vi.useFakeTimers();
    try {
      const now = Temporal.Instant.from("2026-06-07T10:00:00Z");
      const storage = createHiddenFirstRunScanStorage();
      const engine = createWorkflowEngine({
        storage,
        now: () => now,
        createRunId: () => "run_ownerless_future_lease_wakeup",
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_ownerless_future_lease_wakeup_b",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        now: () => now,
        pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
      });
      const def = defineWorkflow<undefined, string>({
        name: "ownerless-future-lease-wakeup",
      });
      client.implementWorkflow(def, () => "reclaimed");

      const handle = await client.runs.start(def, undefined);
      const firstClaim = await engine.store.claimRun({
        runId: handle.runId,
        workerId: "worker_ownerless_future_lease_wakeup_a",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        now,
      });
      if (firstClaim === undefined) {
        throw new Error("Expected initial claim");
      }
      const { workerId: _workerId, ...ownerlessRun } = firstClaim;
      await storage.set(
        makeRunKey("default", firstClaim.id),
        runRecordStorageValue({
          ...ownerlessRun,
          leaseExpiresAt: Temporal.Instant.from("2026-06-07T11:00:00Z"),
        }),
      );

      const loop = worker.run({ maxRuns: 1 });
      await vi.advanceTimersByTimeAsync(0);

      await expect(loop).resolves.toEqual({ processedRuns: 1 });
      await expect(
        handle.result({
          timeout: Temporal.Duration.from({ milliseconds: 0 }),
          pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        }),
      ).resolves.toBe("reclaimed");
      await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
        status: "completed",
        attempts: 2,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("worker polling lease wakeups honor workflow filters", async () => {
    vi.useFakeTimers();
    try {
      let now = Temporal.Instant.from("2026-06-07T10:00:00Z");
      const engine = createWorkflowEngine({
        now: () => now,
        createRunId: sequentialRunIds("run_filtered_lease_left", "run_filtered_lease_right"),
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        workerId: "worker_filtered_lease_b",
        leaseDuration: Temporal.Duration.from({ milliseconds: 60_000 }),
        now: () => now,
        pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
      });
      const leftDef = defineWorkflow<undefined, string>({ name: "filtered-lease-left" });
      const rightDef = defineWorkflow<undefined, string>({
        name: "filtered-lease-right",
      });
      client.implementWorkflow(leftDef, () => "left");
      client.implementWorkflow(rightDef, () => "right");

      const left = await client.runs.start(leftDef, undefined);
      const right = await client.runs.start(rightDef, undefined);
      await engine.store.claimRun({
        runId: left.runId,
        workerId: "worker_filtered_lease_left_a",
        leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
        now,
      });
      await engine.store.claimRun({
        runId: right.runId,
        workerId: "worker_filtered_lease_right_a",
        leaseDuration: Temporal.Duration.from({ milliseconds: 5_000 }),
        now,
      });

      const loop = worker.run({
        maxRuns: 1,
        workflowName: "filtered-lease-right",
      });

      now = Temporal.Instant.from("2026-06-07T10:00:01Z");
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(
        Promise.race([loop.then(() => "settled"), Promise.resolve("pending")]),
      ).resolves.toBe("pending");
      await expect(engine.getRun(left.runId)).resolves.toMatchObject({
        status: "running",
        workerId: "worker_filtered_lease_left_a",
        leaseExpiresAt: Temporal.Instant.from("2026-06-07T10:00:01Z"),
      });
      await expect(engine.getRun(right.runId)).resolves.toMatchObject({
        status: "running",
        workerId: "worker_filtered_lease_right_a",
        leaseExpiresAt: Temporal.Instant.from("2026-06-07T10:00:05Z"),
      });

      now = Temporal.Instant.from("2026-06-07T10:00:05Z");
      await vi.advanceTimersByTimeAsync(4_000);

      await expect(loop).resolves.toEqual({ processedRuns: 1 });
      await expect(
        right.result({
          timeout: Temporal.Duration.from({ milliseconds: 0 }),
          pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        }),
      ).resolves.toBe("right");
      await expect(
        left.result({
          timeout: Temporal.Duration.from({ milliseconds: 0 }),
          pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        }),
      ).rejects.toBeInstanceOf(WorkflowResultTimeoutError);
      await expect(engine.getRun(left.runId)).resolves.toMatchObject({
        status: "running",
        workerId: "worker_filtered_lease_left_a",
      });
      await expect(engine.getRun(right.runId)).resolves.toMatchObject({
        status: "completed",
        attempts: 2,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
