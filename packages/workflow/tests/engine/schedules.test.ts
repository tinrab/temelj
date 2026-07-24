import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { sequentialRunIds } from "../utility.ts";

describe("workflow schedules", () => {
  test("creates and ticks recurring fixed-interval schedules", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_recurring_first", "run_recurring_second"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<{ readonly userId: string }, string>({
      name: "recurring-reminder",
      version: "v1",
    });

    await expect(
      client.schedules.create(def, {
        id: "reminder:user_1",
        every: Temporal.Duration.from({ hours: 1 }),
        input: { userId: "user_1" },
        context: { source: "schedule-test" },
        from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      }),
    ).resolves.toMatchObject({
      id: "reminder:user_1",
      workflowName: "recurring-reminder",
      workflowVersion: "v1",
      input: { userId: "user_1" },
      nextFireAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      status: "active",
      tickCount: 0,
    });

    await expect(client.schedules.tick()).resolves.toEqual({
      ticked: 0,
      runIds: [],
      scheduleIds: [],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.schedules.tick()).resolves.toEqual({
      ticked: 1,
      runIds: ["run_recurring_first"],
      scheduleIds: ["reminder:user_1"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
    });
    await expect(engine.getRun("run_recurring_first")).resolves.toMatchObject({
      workflowName: "recurring-reminder",
      workflowVersion: "v1",
      input: { userId: "user_1" },
      context: {
        source: "schedule-test",
        scheduleId: "reminder:user_1",
        scheduleFireAt: "2026-06-11T11:00:00Z",
      },
      availableAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      idempotencyKey: "schedule:reminder:user_1:2026-06-11T11:00:00Z",
    });

    await expect(client.schedules.get("reminder:user_1")).resolves.toMatchObject({
      lastRunId: "run_recurring_first",
      lastFireAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      nextFireAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      tickCount: 1,
    });

    now = Temporal.Instant.from("2026-06-11T12:00:00Z");
    await expect(engine.tickSchedules()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_recurring_second"],
      scheduleIds: ["reminder:user_1"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
    });
  });

  test("creates schedules with date-unit intervals", async () => {
    const engine = createWorkflowEngine();
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "daily-schedule" });

    await expect(
      client.schedules.create(def, {
        id: "daily",
        every: Temporal.Duration.from({ days: 1 }),
        input: undefined,
        from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      }),
    ).resolves.toMatchObject({
      id: "daily",
      nextFireAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
  });

  test("pauses resumes archives deletes and filters recurring schedules", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_paused_schedule",
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "pause-schedule" });

    await client.schedules.create(def, {
      id: "pause-me",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    await expect(client.schedules.pause("pause-me")).resolves.toMatchObject({ status: "paused" });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({ ticked: 0 });
    await expect(client.schedules.list({ status: "paused" })).resolves.toMatchObject([
      { id: "pause-me" },
    ]);

    await expect(client.schedules.resume("pause-me")).resolves.toMatchObject({ status: "active" });
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_paused_schedule"],
    });
    await expect(client.schedules.delete("pause-me")).resolves.toMatchObject({ status: "deleted" });
    await expect(client.schedules.list({ status: "active" })).resolves.toEqual([]);

    await client.schedules.create(def, {
      id: "archive-me",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T11:00:00Z"),
    });
    await expect(client.schedules.archive("archive-me")).resolves.toMatchObject({
      status: "archived",
    });
    await expect(client.schedules.list({ status: "archived" })).resolves.toMatchObject([
      { id: "archive-me" },
    ]);
    now = Temporal.Instant.from("2026-06-11T12:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({ ticked: 0 });
  });

  test("upserts recurring schedules without resetting tick history", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_upsert_schedule",
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const firstSpec = defineWorkflow<{ readonly userId: string }, string>({
      name: "upsert-schedule",
      version: "v1",
    });
    const nextSpec = defineWorkflow<{ readonly userId: string }, string>({
      name: "upsert-schedule",
      version: "v2",
    });

    await expect(
      client.schedules.upsert(firstSpec, {
        id: "upsert:user_1",
        every: Temporal.Duration.from({ hours: 1 }),
        input: { userId: "user_1" },
        from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      }),
    ).resolves.toMatchObject({
      id: "upsert:user_1",
      workflowName: "upsert-schedule",
      workflowVersion: "v1",
      nextFireAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      tickCount: 0,
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_upsert_schedule"],
    });
    const ticked = await client.schedules.get("upsert:user_1");
    expect(ticked).toMatchObject({
      createdAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      lastRunId: "run_upsert_schedule",
      tickCount: 1,
    });

    now = Temporal.Instant.from("2026-06-11T12:00:00Z");
    await expect(
      client.schedules.upsert(nextSpec, {
        id: "upsert:user_1",
        every: Temporal.Duration.from({ minutes: 30 }),
        input: { userId: "user_2" },
        from: Temporal.Instant.from("2026-06-11T12:00:00Z"),
        catchUp: "skip",
        overlap: "skip",
      }),
    ).resolves.toMatchObject({
      id: "upsert:user_1",
      workflowName: "upsert-schedule",
      workflowVersion: "v2",
      input: { userId: "user_2" },
      createdAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      updatedAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      nextFireAt: Temporal.Instant.from("2026-06-11T12:30:00Z"),
      lastRunId: "run_upsert_schedule",
      tickCount: 1,
      catchUp: "skip",
      overlap: "skip",
    });
  });

  test("pages recurring schedules by next fire time", async () => {
    const engine = createWorkflowEngine();
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "paged-schedule" });

    await client.schedules.create(def, {
      id: "later",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    await client.schedules.create(def, {
      id: "earlier",
      every: Temporal.Duration.from({ minutes: 30 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    const firstPage = await client.schedules.page({ limit: 1 });
    expect(firstPage).toMatchObject({
      items: [{ id: "earlier" }],
      hasMore: true,
    });
    expect(firstPage.nextCursor).toBeDefined();
    await expect(
      engine.listSchedulesPage({ cursor: firstPage.nextCursor, limit: 1 }),
    ).resolves.toMatchObject({
      items: [{ id: "later" }],
      hasMore: false,
    });
  });

  test("schedules the next workflow run with explicit idempotency", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_schedule_next", "run_schedule_duplicate"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<{ readonly userId: string }, string>({
      name: "scheduled-reminder",
    });

    const handle = await client.schedules.next(
      def,
      { userId: "user_1" },
      {
        every: Temporal.Duration.from({ hours: 2 }),
        from: Temporal.Instant.from("2026-06-11T10:30:00Z"),
        idempotencyKey: "reminder:user_1:2026-06-11T12:30:00Z",
        context: { source: "test" },
      },
    );

    expect(handle.runId).toBe("run_schedule_next");
    await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
      id: "run_schedule_next",
      input: { userId: "user_1" },
      context: { source: "test" },
      availableAt: Temporal.Instant.from("2026-06-11T12:30:00Z"),
      idempotencyKey: "reminder:user_1:2026-06-11T12:30:00Z",
      status: "pending",
    });

    const duplicate = await engine.scheduleNextWorkflow(
      def,
      { userId: "ignored" },
      {
        every: Temporal.Duration.from({ hours: 2 }),
        from: Temporal.Instant.from("2026-06-11T10:30:00Z"),
        idempotencyKey: "reminder:user_1:2026-06-11T12:30:00Z",
      },
    );

    expect(duplicate.runId).toBe("run_schedule_next");
    await expect(engine.getRun("run_schedule_duplicate")).resolves.toBeUndefined();
  });

  test("starts scheduled workflows through the client", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_invalid_schedule",
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "invalid-schedule" });

    await expect(
      client.schedules.next(def, undefined, {
        every: Temporal.Duration.from({ milliseconds: 0 }),
        idempotencyKey: "key",
      }),
    ).resolves.toMatchObject({ runId: "run_invalid_schedule" });
    await expect(engine.listRuns()).resolves.toHaveLength(1);
  });
});
