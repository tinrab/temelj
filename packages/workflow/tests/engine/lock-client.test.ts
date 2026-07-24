import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";

describe("workflow lock client API", () => {
  test("acquires releases and reacquires locks with fencing tokens", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });

    await expect(
      client.locks.acquire("customer:1", {
        holderId: "run-a",
        holderRunId: "run-a",
        leaseDuration: Temporal.Duration.from({ minutes: 1 }),
      }),
    ).resolves.toMatchObject({
      key: "customer:1",
      holderId: "run-a",
      holderRunId: "run-a",
      fencingToken: 1,
      acquiredAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      leaseExpiresAt: Temporal.Instant.from("2026-06-11T10:01:00Z"),
    });

    await expect(
      client.locks.acquire("customer:1", {
        holderId: "run-b",
        leaseDuration: Temporal.Duration.from({ minutes: 1 }),
      }),
    ).rejects.toThrow("Workflow lock is already held: customer:1");

    await expect(
      client.locks.release("customer:1", {
        holderId: "run-a",
      }),
    ).resolves.toMatchObject({
      key: "customer:1",
      holderId: "run-a",
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    await expect(
      engine.acquireLock("customer:1", {
        holderId: "run-b",
        leaseDuration: Temporal.Duration.from({ minutes: 1 }),
      }),
    ).resolves.toMatchObject({
      holderId: "run-b",
      fencingToken: 2,
    });
  });

  test("allows stale lock takeover and rejects holder mismatches", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({ now: () => now });
    const client = createWorkflowClient({ engine });

    await client.locks.acquire("invoice:1", {
      holderId: "first",
      leaseDuration: Temporal.Duration.from({ seconds: 1 }),
    });

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    await expect(
      client.locks.acquire("invoice:1", {
        holderId: "second",
        holderStepId: "lock:invoice",
        leaseDuration: Temporal.Duration.from({ seconds: 2 }),
      }),
    ).resolves.toMatchObject({
      holderId: "second",
      holderStepId: "lock:invoice",
      fencingToken: 2,
      acquiredAt: Temporal.Instant.from("2026-06-11T10:00:01Z"),
      leaseExpiresAt: Temporal.Instant.from("2026-06-11T10:00:03Z"),
    });

    await expect(
      client.locks.release("invoice:1", {
        holderId: "first",
      }),
    ).rejects.toThrow("Workflow lock holder mismatch: invoice:1");

    await expect(client.locks.get("invoice:1")).resolves.toMatchObject({
      holderId: "second",
      fencingToken: 2,
    });
  });

  test("lists locks and includes stale locks in recovery summaries", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({ now: () => now });
    const client = createWorkflowClient({ engine });

    await client.locks.acquire("active", {
      holderId: "active-holder",
      leaseDuration: Temporal.Duration.from({ hours: 1 }),
    });
    await client.locks.acquire("stale", {
      holderId: "stale-holder",
      leaseDuration: Temporal.Duration.from({ seconds: 1 }),
    });
    await client.locks.acquire("released", {
      holderId: "released-holder",
      leaseDuration: Temporal.Duration.from({ seconds: 1 }),
    });
    await client.locks.release("released", { holderId: "released-holder" });

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");

    await expect(client.locks.list()).resolves.toMatchObject([
      { key: "active" },
      { key: "released" },
      { key: "stale" },
    ]);
    await expect(client.runs.recovery()).resolves.toMatchObject({
      lock: {
        total: 2,
        stale: 1,
        keys: ["active", "stale"],
        staleKeys: ["stale"],
        holderIds: ["active-holder", "stale-holder"],
        nextExpiresAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
        nextExpiringKey: "active",
        oldestStaleAt: Temporal.Instant.from("2026-06-11T10:00:01Z"),
      },
      nextRecoveryAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
    });
  });

  test("releases stale locks as an explicit recovery action", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({ now: () => now });
    const client = createWorkflowClient({ engine });

    await client.locks.acquire("recover-stale", {
      holderId: "stale-holder",
      leaseDuration: Temporal.Duration.from({ seconds: 1 }),
    });
    await client.locks.acquire("recover-active", {
      holderId: "active-holder",
      leaseDuration: Temporal.Duration.from({ hours: 1 }),
    });

    await expect(client.locks.releaseStale("recover-active")).rejects.toThrow(
      "Workflow lock is not stale: recover-active",
    );

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    await expect(client.locks.releaseStale("recover-stale")).resolves.toMatchObject({
      key: "recover-stale",
      holderId: "stale-holder",
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:01Z"),
    });
    await expect(client.locks.releaseStale("recover-stale")).rejects.toThrow(
      "Workflow lock is already released: recover-stale",
    );
    await expect(client.runs.recovery()).resolves.toMatchObject({
      lock: {
        keys: ["recover-active"],
        staleKeys: [],
      },
    });
  });

  test("validates lock option semantics", async () => {
    const client = createWorkflowClient({ engine: createWorkflowEngine() });

    await expect(
      client.locks.acquire("bad", {
        holderId: "holder",
        leaseDuration: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toMatchObject({ name: "WorkflowOptionsError" });
    await expect(
      client.locks.acquire("bad", {
        holderId: "holder",
        leaseDuration: Temporal.Duration.from({ seconds: 1 }),
        waitTimeout: Temporal.Duration.from({ seconds: 1 }),
      }),
    ).rejects.toThrow("Workflow lock timeout options require wait: true");
    await expect(
      client.locks.acquire("bad", {
        holderId: "holder",
        leaseDuration: Temporal.Duration.from({ seconds: 1 }),
        wait: true,
        waitTimeout: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toMatchObject({ name: "WorkflowOptionsError" });
    await expect(
      client.locks.acquire("bad", {
        holderId: "holder",
        leaseDuration: Temporal.Duration.from({ seconds: 1 }),
        wait: true,
        waitTimeout: Temporal.Duration.from({ seconds: 1 }),
        waitDeadlineAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      }),
    ).rejects.toThrow("Workflow lock options cannot include both waitTimeout and waitDeadlineAt");
  });
});
