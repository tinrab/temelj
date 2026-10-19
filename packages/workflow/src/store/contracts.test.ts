import { describe, expect, expectTypeOf, test } from "vitest";

import type { EventRecord } from "../types/events.ts";
import type { WorkflowStore, StoreCapabilities } from "../types/store.ts";

import { pendingRun, storeFactories } from "../testing/store-contract.ts";
import { createWorkflowStore } from "./create.ts";

interface StoreContractOptions {
  readonly name: string;
  readonly createStore: () => WorkflowStore | Promise<WorkflowStore>;
}

export function describeStoreContract(options: StoreContractOptions): void {
  describe(`${options.name}`, () => {
    test("creates runs atomically with event history and idempotency", async () => {
      const store = await options.createStore();

      const run = pendingRun(store, "run-create", {
        idempotencyKey: "create-key",
      });

      await expect(store.createRun(run)).resolves.toEqual(run);
      await expect(store.getRun(run.id)).resolves.toEqual(run);
      await expect(store.getEvents(run.id)).resolves.toEqual([]);
      await expect(
        store.getRunByIdempotencyKey({
          workflowName: run.workflowName,
          workflowVersion: run.workflowVersion,
          idempotencyKey: "create-key",
        }),
      ).resolves.toEqual(run);

      const duplicate = pendingRun(store, "run-create-duplicate", {
        idempotencyKey: "create-key",
      });

      await expect(store.createRun(duplicate)).resolves.toEqual(run);
      await expect(store.getRun("run-create-duplicate")).resolves.toBeUndefined();
    });

    test("claims, reclaims, extends, and releases run leases conditionally", async () => {
      const store = await options.createStore();
      const base = Temporal.Instant.from("2025-01-01T00:00:00Z");
      await store.createRun(pendingRun(store, "run-lease"));

      const claimed = await store.claimRun({
        runId: "run-lease",
        workerId: "worker-a",
        now: base,
        leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      });

      expect(claimed).toMatchObject({
        id: "run-lease",
        status: "running",
        workerId: "worker-a",
        attempts: 1,
        lastTransitionReason: "claimed",
      });

      await expect(
        store.claimRun({
          runId: "run-lease",
          workerId: "worker-b",
          now: Temporal.Instant.from("2025-01-01T00:00:00.500Z"),
          leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
        }),
      ).resolves.toBeUndefined();

      const extended = await store.extendRunLease({
        runId: "run-lease",
        workerId: "worker-a",
        attempts: 1,
        now: Temporal.Instant.from("2025-01-01T00:00:00.500Z"),
        leaseDuration: Temporal.Duration.from({ milliseconds: 2_000 }),
      });

      expect(extended?.leaseExpiresAt).toEqual(Temporal.Instant.from("2025-01-01T00:00:02.500Z"));

      await expect(
        store.extendRunLease({
          runId: "run-lease",
          workerId: "worker-b",
          attempts: 1,
          now: Temporal.Instant.from("2025-01-01T00:00:00.750Z"),
          leaseDuration: Temporal.Duration.from({ milliseconds: 2_000 }),
        }),
      ).resolves.toBeUndefined();

      const released = await store.releaseRunLease({
        runId: "run-lease",
        workerId: "worker-a",
        attempts: 1,
        now: Temporal.Instant.from("2025-01-01T00:00:01Z"),
      });

      expect(released).toMatchObject({
        status: "waiting",
        lastTransitionReason: "waiting",
      });
      expect(released).not.toHaveProperty("workerId");
      expect(released).not.toHaveProperty("leaseExpiresAt");

      await store.updateRun({
        ...released!,
        status: "running",
        workerId: "worker-old",
        updatedAt: Temporal.Instant.from("2025-01-01T00:00:03Z"),
        lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:03Z"),
        lastTransitionReason: "claimed",
        leaseExpiresAt: Temporal.Instant.from("2025-01-01T00:00:04Z"),
      });

      const reclaimed = await store.claimRun({
        runId: "run-lease",
        workerId: "worker-new",
        now: Temporal.Instant.from("2025-01-01T00:00:05Z"),
        leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      });

      expect(reclaimed).toMatchObject({
        workerId: "worker-new",
        attempts: 2,
        lastTransitionReason: "reclaimed",
      });
    });

    test("rejects stale conditional run updates and event appends", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-stale"));

      const claimed = await store.claimRun({
        runId: run.id,
        workerId: "worker-a",
        now: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      });

      expect(claimed).toBeDefined();

      const staleUpdate = await store.updateRunIfCurrent(run, {
        ...run,
        status: "waiting",
        updatedAt: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        lastTransitionReason: "waiting",
        availableAt: Temporal.Instant.from("2025-01-01T00:00:01Z"),
      });

      expect(staleUpdate).toBeUndefined();

      const staleAppend = await store.appendEventIfRunCurrent(run, workflowStarted());
      expect(staleAppend).toBeUndefined();
      expect(await store.getEvents(run.id)).toEqual([]);
    });

    test("lists, counts, and pages runs with core filters", async () => {
      const store = await options.createStore();
      await store.createRun(
        pendingRun(store, "run-list-a", {
          attributes: { customer: "acme", priority: 1 },
        }),
      );
      await store.createRun(
        pendingRun(store, "run-list-b", {
          workflowName: "other-workflow",
          status: "waiting",
          availableAt: Temporal.Instant.from("2025-01-01T00:05:00Z"),
          lastTransitionReason: "rescheduled",
          attributes: { customer: "acme", region: "eu" },
        }),
      );
      await store.createRun(
        pendingRun(store, "run-list-c", {
          status: "failed",
          finishedAt: Temporal.Instant.from("2025-01-01T00:10:00Z"),
          lastTransitionReason: "permanent_failure",
          error: { name: "Error", message: "failed" },
          attributes: { customer: "other" },
        }),
      );

      await expect(store.listRuns({ status: ["pending", "waiting"] })).resolves.toEqual([
        expect.objectContaining({ id: "run-list-a" }),
        expect.objectContaining({ id: "run-list-b" }),
      ]);
      await expect(
        store.countRuns({
          attributes: { customer: "acme" },
          attributeExists: "region",
        }),
      ).resolves.toBe(1);
      await expect(
        store.listRuns({
          lastTransitionReason: ["rescheduled", "permanent_failure"],
        }),
      ).resolves.toEqual([
        expect.objectContaining({ id: "run-list-b" }),
        expect.objectContaining({ id: "run-list-c" }),
      ]);

      const firstPage = await store.listRunsPage({ limit: 2 });
      expect(firstPage).toMatchObject({
        items: [{ id: "run-list-a" }, { id: "run-list-b" }],
        hasMore: true,
      });
      expect(firstPage.nextCursor).toBeDefined();

      const secondPage = await store.listRunsPage({
        limit: 2,
        cursor: firstPage.nextCursor,
      });

      expect(secondPage).toMatchObject({
        items: [{ id: "run-list-c" }],
        hasMore: false,
      });
    });
  });
}

for (const factory of storeFactories) {
  describeStoreContract({
    name: `workflow store contract: ${factory.name}`,
    createStore: factory.create,
  });
}

test("exports store contract types from the store entrypoint", () => {
  const store = createWorkflowStore();

  expectTypeOf(store).toMatchTypeOf<WorkflowStore>();
  expectTypeOf(store.capabilities).toMatchTypeOf<StoreCapabilities>();
});

function workflowStarted(): EventRecord {
  return {
    kind: "workflow_started",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
  };
}
