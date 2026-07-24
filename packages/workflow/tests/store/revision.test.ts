import { createStorage, InMemoryStorageEngine, type StorageEngine } from "@temelj/storage";
import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { deleteCleanupIndexes } from "../../src/store/cleanup.ts";
import { createWorkflowStore } from "../../src/store/create.ts";
import { isSameWorkflowStorageValue } from "../../src/store/revision.ts";

describe("workflow storage revision equality", () => {
  test("ignores object property insertion order recursively", () => {
    const left = {
      run: {
        id: "run-1",
        metadata: { region: "eu", priority: 1 },
      },
      tags: ["durable", "workflow"],
    };
    const right = {
      tags: ["durable", "workflow"],
      run: {
        metadata: { priority: 1, region: "eu" },
        id: "run-1",
      },
    };

    expect(isSameWorkflowStorageValue(left, right)).toBe(true);
  });

  test("still treats array order and nested values as revision data", () => {
    expect(isSameWorkflowStorageValue({ values: [1, 2] }, { values: [2, 1] })).toBe(false);
    expect(isSameWorkflowStorageValue({ nested: { value: 1 } }, { nested: { value: 2 } })).toBe(
      false,
    );
  });

  test("returns false for incomparable calendar durations instead of throwing", () => {
    expect(
      isSameWorkflowStorageValue(
        { duration: Temporal.Duration.from("P1M") },
        { duration: Temporal.Duration.from("P30D") },
      ),
    ).toBe(false);
    expect(
      isSameWorkflowStorageValue(
        { duration: Temporal.Duration.from("P1M") },
        { duration: Temporal.Duration.from("P1M") },
      ),
    ).toBe(true);
  });

  test("accepts reordered nested objects in the non-conditional run update path", async () => {
    const store = createWorkflowStore({ namespace: "revision", storage: nonConditionalStorage() });
    const createdAt = Temporal.Instant.from("2026-07-17T07:00:00Z");
    const run: WorkflowRunRecord = {
      id: "run-1",
      namespace: store.namespace,
      workflowName: "revision",
      status: "pending",
      input: { first: 1, second: 2 },
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
      lastTransitionAt: createdAt,
      lastTransitionReason: "created",
    };
    await store.createRun(run);
    const current = (await store.getRun(run.id))!;
    const reorderedCurrent: WorkflowRunRecord = {
      ...current,
      input: { second: 2, first: 1 },
    };
    const updatedAt = Temporal.Instant.from("2026-07-17T08:00:00Z");

    await expect(
      store.updateRunIfCurrent(reorderedCurrent, {
        ...reorderedCurrent,
        status: "waiting",
        availableAt: updatedAt,
        updatedAt,
        lastTransitionAt: updatedAt,
        lastTransitionReason: "waiting",
      }),
    ).resolves.toMatchObject({ status: "waiting" });
  });

  test("deletes semantically equal reordered cleanup indexes without conditional writes", async () => {
    const storage = nonConditionalStorage();
    await storage.set("index", { nested: { first: 1, second: 2 } });

    await expect(
      deleteCleanupIndexes(storage, [{ key: "index", value: { nested: { second: 2, first: 1 } } }]),
    ).resolves.toBe(1);
    await expect(storage.get("index")).resolves.toBeUndefined();
  });
});

function nonConditionalStorage() {
  const engine = new InMemoryStorageEngine<string>();
  const nonConditionalEngine: StorageEngine<string> = {
    name: "non-conditional-memory",
    get: (key) => engine.get(key),
    set: (key, value, options) => engine.set(key, value, options),
    delete: (key) => engine.delete(key),
    keys: (options) => engine.keys(options),
    clear: (options) => engine.clear(options),
  };
  return createStorage({
    engine: nonConditionalEngine,
  });
}
