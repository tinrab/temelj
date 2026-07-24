import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { sequentialRunIds } from "../utility.ts";

describe("workflow schedule catch-up", () => {
  test("catches up every missed recurring run up to the schedule bound", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_catch_up_first", "run_catch_up_second"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "catch-up-schedule" });

    await client.schedules.create(def, {
      id: "catch-up",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      catchUp: "all",
      maxCatchUpRuns: 2,
    });

    now = Temporal.Instant.from("2026-06-11T14:30:00Z");
    await expect(client.schedules.tick()).resolves.toEqual({
      ticked: 2,
      runIds: ["run_catch_up_first", "run_catch_up_second"],
      scheduleIds: ["catch-up"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
    });
    await expect(engine.getRun("run_catch_up_first")).resolves.toMatchObject({
      availableAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      idempotencyKey: "schedule:catch-up:2026-06-11T11:00:00Z",
    });
    await expect(engine.getRun("run_catch_up_second")).resolves.toMatchObject({
      availableAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      idempotencyKey: "schedule:catch-up:2026-06-11T12:00:00Z",
    });
    await expect(client.schedules.get("catch-up")).resolves.toMatchObject({
      lastRunId: "run_catch_up_second",
      lastFireAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      nextFireAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
      tickCount: 2,
    });
  });

  test("recovers schedule ticks after a run is created before schedule advancement", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_existing_schedule_tick", "run_duplicate_schedule_tick"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "idempotent-schedule" });

    await client.schedules.create(def, {
      id: "idempotent",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    await engine.startWorkflow(def, undefined, {
      availableAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      idempotencyKey: "schedule:idempotent:2026-06-11T11:00:00Z",
      context: {
        scheduleId: "idempotent",
        scheduleFireAt: "2026-06-11T11:00:00Z",
      },
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.schedules.tick()).resolves.toEqual({
      ticked: 1,
      runIds: ["run_existing_schedule_tick"],
      scheduleIds: ["idempotent"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
    });
    await expect(engine.getRun("run_duplicate_schedule_tick")).resolves.toBeUndefined();
    await expect(client.schedules.get("idempotent")).resolves.toMatchObject({
      lastRunId: "run_existing_schedule_tick",
      lastFireAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      nextFireAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      tickCount: 1,
    });
  });

  test("skips recurring runs that exceed maximum lateness", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_late_first", "run_late_second"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "late-schedule" });

    await client.schedules.create(def, {
      id: "late",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      maxLateness: Temporal.Duration.from({ minutes: 30 }),
    });

    now = Temporal.Instant.from("2026-06-11T11:45:00Z");
    await expect(client.schedules.tick()).resolves.toEqual({
      ticked: 0,
      runIds: [],
      scheduleIds: ["late"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T12:45:00Z"),
    });
    await expect(engine.getRun("run_late_first")).resolves.toBeUndefined();
  });

  test("catches up only missed runs within maximum lateness", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_late_catch_up_first", "run_late_catch_up_second"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "late-catch-up-schedule" });

    await client.schedules.create(def, {
      id: "late-catch-up",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      catchUp: "all",
      maxCatchUpRuns: 3,
      maxLateness: Temporal.Duration.from({ minutes: 90 }),
    });

    now = Temporal.Instant.from("2026-06-11T14:00:00Z");
    await expect(client.schedules.tick()).resolves.toEqual({
      ticked: 2,
      runIds: ["run_late_catch_up_first", "run_late_catch_up_second"],
      scheduleIds: ["late-catch-up"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T15:00:00Z"),
    });
    await expect(engine.getRun("run_late_catch_up_first")).resolves.toMatchObject({
      availableAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
    });
    await expect(engine.getRun("run_late_catch_up_second")).resolves.toMatchObject({
      availableAt: Temporal.Instant.from("2026-06-11T14:00:00Z"),
    });
  });

  test("stops recurring schedules after the configured end time", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_ending_first", "run_ending_second"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "ending-schedule" });

    await expect(
      client.schedules.create(def, {
        id: "ending",
        every: Temporal.Duration.from({ hours: 1 }),
        input: undefined,
        from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
        endAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      }),
    ).resolves.toMatchObject({
      status: "active",
      endAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      nextFireAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_ending_first"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
    });
    now = Temporal.Instant.from("2026-06-11T12:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_ending_second"],
    });
    await expect(client.schedules.get("ending")).resolves.toMatchObject({
      status: "deleted",
      lastFireAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      nextFireAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
      tickCount: 2,
    });
    await expect(client.schedules.list({ status: "active" })).resolves.toEqual([]);
  });

  test("deletes recurring schedules whose first fire is after the end time", async () => {
    const client = createWorkflowClient();
    const def = defineWorkflow<undefined, string>({ name: "already-ended-schedule" });

    await expect(
      client.schedules.create(def, {
        id: "already-ended",
        every: Temporal.Duration.from({ hours: 1 }),
        input: undefined,
        from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
        endAt: Temporal.Instant.from("2026-06-11T10:30:00Z"),
      }),
    ).resolves.toMatchObject({
      status: "deleted",
      nextFireAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      endAt: Temporal.Instant.from("2026-06-11T10:30:00Z"),
    });
    await expect(
      client.schedules.tick({ now: Temporal.Instant.from("2026-06-11T11:00:00Z") }),
    ).resolves.toEqual({
      ticked: 0,
      runIds: [],
      scheduleIds: [],
    });
  });
});
