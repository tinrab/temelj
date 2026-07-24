import { createStorage, createSuperJsonStorageCodec } from "@temelj/storage";
import { FileSystemStorageEngine } from "@temelj/storage/filesystem";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";

import type { EventRecord } from "../../src/types/events.ts";
import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { createWorkflowStore } from "../../src/store/create.ts";
import {
  WorkflowCleanupRepository,
  WorkflowEventHistoryWatcher,
  WorkflowEventLog,
  WorkflowIdempotencyIndex,
  WorkflowLockRepository,
  WorkflowMessageIdempotencyIndexLookup,
  WorkflowMessageIdempotencyRepairModel,
  WorkflowRunRepository,
  WorkflowScheduleRepository,
  WorkflowStepAttemptLookup,
  WorkflowStepAttemptReadModel,
  WorkflowStore,
  WorkflowStoreCapabilities,
  WorkflowStoreMetadata,
} from "../../src/types/store.ts";

const temporaryDirectories: string[] = [];

export interface WorkflowStoreContractOptions {
  readonly name: string;
  readonly createStore: () => WorkflowStore | Promise<WorkflowStore>;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => await rm(directory, { force: true, recursive: true })),
  );
});

export function describeWorkflowStoreContract(options: WorkflowStoreContractOptions): void {
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

describeWorkflowStoreContract({
  name: "workflow store contract: default in-memory storage",
  createStore: () =>
    createWorkflowStore({
      namespace: `contract-${Temporal.Now.instant().epochMilliseconds.toString(36)}-${Math.random()}`,
    }),
});

describeWorkflowStoreContract({
  name: "workflow store contract: filesystem storage adapter",
  createStore: async () => {
    const directory = await temporaryDirectory();
    return createWorkflowStore({
      namespace: `contract-${Temporal.Now.instant().epochMilliseconds.toString(36)}-${Math.random()}`,
      storage: createStorage({
        codec: createSuperJsonStorageCodec({ format: "bytes" }),
        engine: new FileSystemStorageEngine({
          directory,
          prefix: "workflow",
        }),
      }),
    });
  },
});

test("exports store contract types from the store entrypoint", () => {
  const store = createWorkflowStore();

  expectTypeOf(store).toMatchTypeOf<WorkflowStoreMetadata>();
  expectTypeOf(store).toMatchTypeOf<WorkflowRunRepository>();
  expectTypeOf(store).toMatchTypeOf<WorkflowIdempotencyIndex>();
  expectTypeOf(store).toMatchTypeOf<WorkflowMessageIdempotencyIndexLookup>();
  expectTypeOf(store).toMatchTypeOf<WorkflowMessageIdempotencyRepairModel>();
  expectTypeOf(store).toMatchTypeOf<WorkflowEventHistoryWatcher>();
  expectTypeOf(store).toMatchTypeOf<WorkflowEventLog>();
  expectTypeOf(store).toMatchTypeOf<WorkflowStepAttemptLookup>();
  expectTypeOf(store).toMatchTypeOf<WorkflowStepAttemptReadModel>();
  expectTypeOf(store).toMatchTypeOf<WorkflowCleanupRepository>();
  expectTypeOf(store).toMatchTypeOf<WorkflowScheduleRepository>();
  expectTypeOf(store).toMatchTypeOf<WorkflowLockRepository>();
  expectTypeOf(store).toMatchTypeOf<WorkflowStore>();
  expectTypeOf(store.capabilities).toMatchTypeOf<WorkflowStoreCapabilities>();
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "temelj-workflow-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

function pendingRun(
  store: WorkflowStore,
  id: string,
  options: Partial<WorkflowRunRecord> = {},
): WorkflowRunRecord {
  const { id: _id, namespace: _namespace, ...patch } = options;
  return {
    id,
    namespace: store.namespace,
    workflowName: "contract-workflow",
    workflowVersion: "v1",
    status: "pending",
    input: undefined,
    attempts: 0,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionReason: "created",
    ...patch,
  };
}

function workflowStarted(): EventRecord {
  return {
    kind: "workflow_started",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
  };
}
