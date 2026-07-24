import { createStorage, createSuperJsonStorageCodec } from "@temelj/storage";
import { FileSystemStorageEngine } from "@temelj/storage/filesystem";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { LockRecord } from "../../src/types/lock.ts";
import type { ScheduleRecord } from "../../src/types/schedule.ts";
import type { WorkflowStore } from "../../src/types/store.ts";

import { createWorkflowStore } from "../../src/store/create.ts";

const temporaryDirectories: string[] = [];

interface WorkflowStoreContractOptions {
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

function describeWorkflowStoreLockScheduleContract(options: WorkflowStoreContractOptions): void {
  describe(`${options.name}`, () => {
    test("creates, filters, and conditionally updates schedules", async () => {
      const store = await options.createStore();
      const active = scheduleRecord(store, "schedule-a");
      const paused = scheduleRecord(store, "schedule-b", {
        workflowName: "other-workflow",
        workflowVersion: "v2",
        status: "paused",
        catchUp: "all",
        maxCatchUpRuns: 3,
        maxLateness: Temporal.Duration.from({ milliseconds: 120_000 }),
        overlap: "cancel",
        bufferedFireAt: Temporal.Instant.from("2025-01-01T00:04:00Z"),
        endAt: Temporal.Instant.from("2025-01-01T00:10:00Z"),
        nextFireAt: Temporal.Instant.from("2025-01-01T00:05:00Z"),
      });
      await expect(store.createSchedule(active)).resolves.toEqual(active);
      await expect(store.createSchedule(active)).rejects.toThrow(
        "Workflow schedule already exists: schedule-a",
      );
      await expect(store.createSchedule(paused)).resolves.toEqual(paused);
      await expect(store.getSchedule(active.id)).resolves.toEqual(active);

      await expect(store.listSchedules({ status: "active" })).resolves.toEqual([active]);
      await expect(store.listSchedules({ workflowName: "other-workflow" })).resolves.toEqual([
        paused,
      ]);
      await expect(store.listSchedules({ workflowVersion: "v1", limit: 1 })).resolves.toEqual([
        active,
      ]);
      const firstPage = await store.listSchedulesPage({ limit: 1 });
      expect(firstPage).toMatchObject({
        items: [{ id: "schedule-a" }],
        hasMore: true,
      });
      expect(firstPage.nextCursor).toBeDefined();
      await expect(
        store.listSchedulesPage({ cursor: firstPage.nextCursor, limit: 1 }),
      ).resolves.toMatchObject({
        items: [{ id: "schedule-b" }],
        hasMore: false,
      });

      const archived = scheduleRecord(store, "schedule-c", {
        status: "archived",
      });
      await expect(store.createSchedule(archived)).resolves.toEqual(archived);
      await expect(store.listSchedules({ status: "archived" })).resolves.toEqual([archived]);

      const updated = {
        ...active,
        updatedAt: Temporal.Instant.from("2025-01-01T00:01:00Z"),
        nextFireAt: Temporal.Instant.from("2025-01-01T00:01:00Z"),
        lastFireAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        lastRunId: "run-from-schedule",
        tickCount: 1,
      };
      await expect(store.updateScheduleIfCurrent(active, updated)).resolves.toEqual(updated);
      await expect(
        store.updateScheduleIfCurrent(active, { ...updated, tickCount: 2 }),
      ).resolves.toBeUndefined();
      await expect(store.getSchedule(active.id)).resolves.toEqual(updated);
    });

    test("creates, lists, and conditionally updates locks", async () => {
      const store = await options.createStore();
      const first = lockRecord(store, "lock-a");
      const second = lockRecord(store, "lock-b", {
        holderId: "holder-b",
        fencingToken: 3,
        acquiredAt: Temporal.Instant.from("2025-01-01T00:02:00Z"),
        leaseExpiresAt: Temporal.Instant.from("2025-01-01T00:03:00Z"),
      });

      await expect(store.getLock(first.key)).resolves.toBeUndefined();
      await expect(store.updateLockIfCurrent(undefined, first)).resolves.toEqual(first);
      await expect(store.updateLockIfCurrent(undefined, second)).resolves.toEqual(second);
      await expect(
        store.updateLockIfCurrent(undefined, { ...first, holderId: "late" }),
      ).resolves.toBeUndefined();
      await expect(store.getLock(first.key)).resolves.toEqual(first);
      await expect(store.listLocks()).resolves.toEqual([first, second]);

      const renewed = {
        ...first,
        holderId: "holder-a-renewed",
        fencingToken: 2,
        acquiredAt: Temporal.Instant.from("2025-01-01T00:04:00Z"),
        leaseExpiresAt: Temporal.Instant.from("2025-01-01T00:05:00Z"),
      };
      await expect(store.updateLockIfCurrent(first, renewed)).resolves.toEqual(renewed);
      await expect(
        store.updateLockIfCurrent(first, { ...renewed, fencingToken: 4 }),
      ).resolves.toBeUndefined();
      await expect(store.getLock(first.key)).resolves.toEqual(renewed);
    });
  });
}

describeWorkflowStoreLockScheduleContract({
  name: "workflow store lock and schedule contract: default in-memory storage",
  createStore: () =>
    createWorkflowStore({
      namespace: `contract-${Temporal.Now.instant().epochMilliseconds.toString(36)}-${Math.random()}`,
    }),
});

describeWorkflowStoreLockScheduleContract({
  name: "workflow store lock and schedule contract: filesystem storage adapter",
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

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "temelj-workflow-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

function scheduleRecord(
  store: WorkflowStore,
  id: string,
  options: Partial<ScheduleRecord> = {},
): ScheduleRecord {
  const { id: _id, namespace: _namespace, ...patch } = options;
  return {
    id,
    namespace: store.namespace,
    workflowName: "contract-workflow",
    workflowVersion: "v1",
    input: { value: id },
    status: "active",
    every: Temporal.Duration.from({ milliseconds: 60_000 }),
    catchUp: "one",
    overlap: "skip",
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    nextFireAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    tickCount: 0,
    ...patch,
  };
}

function lockRecord(
  store: WorkflowStore,
  key: string,
  options: Partial<LockRecord> = {},
): LockRecord {
  const { key: _key, namespace: _namespace, ...patch } = options;
  return {
    key,
    namespace: store.namespace,
    holderId: "holder-a",
    fencingToken: 1,
    acquiredAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    leaseExpiresAt: Temporal.Instant.from("2025-01-01T00:01:00Z"),
    ...patch,
  };
}
