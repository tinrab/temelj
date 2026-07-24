import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { sequentialRunIds } from "../utility.ts";

describe("workflow schedule overlap policies", () => {
  test("skips overlapping recurring runs when requested", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_overlap_first", "run_overlap_second"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "overlap-schedule" });

    await client.schedules.create(def, {
      id: "overlap",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      overlap: "skip",
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_overlap_first"],
    });
    now = Temporal.Instant.from("2026-06-11T12:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 0,
      runIds: [],
      scheduleIds: ["overlap"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
    });
    await expect(engine.getRun("run_overlap_second")).resolves.toBeUndefined();
  });

  test("buffers one overlapping recurring run until the previous run is terminal", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_buffer_first", "run_buffer_second", "run_buffer_third"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "buffer-schedule" });

    await client.schedules.create(def, {
      id: "buffer",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      overlap: "buffer",
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_buffer_first"],
    });
    now = Temporal.Instant.from("2026-06-11T12:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 0,
      runIds: [],
      scheduleIds: ["buffer"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
    });
    await expect(client.schedules.get("buffer")).resolves.toMatchObject({
      bufferedFireAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      nextFireAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
      tickCount: 1,
    });
    await expect(engine.getRun("run_buffer_second")).resolves.toBeUndefined();

    await engine.cancelRun("run_buffer_first");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_buffer_second"],
      scheduleIds: ["buffer"],
      nextScheduleAt: Temporal.Instant.from("2026-06-11T13:00:00Z"),
    });
    await expect(engine.getRun("run_buffer_second")).resolves.toMatchObject({
      availableAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      idempotencyKey: "schedule:buffer:2026-06-11T12:00:00Z",
    });
    const drained = await client.schedules.get("buffer");
    expect(drained?.bufferedFireAt).toBeUndefined();
    expect(drained).toMatchObject({
      lastRunId: "run_buffer_second",
      lastFireAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      tickCount: 2,
    });
  });

  test("cancels overlapping recurring runs when requested", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_cancel_overlap_first", "run_cancel_overlap_second"),
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "cancel-overlap-schedule" });

    await client.schedules.create(def, {
      id: "cancel-overlap",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      overlap: "cancel",
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_cancel_overlap_first"],
    });
    now = Temporal.Instant.from("2026-06-11T12:00:00Z");
    await expect(client.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      runIds: ["run_cancel_overlap_second"],
      scheduleIds: ["cancel-overlap"],
    });
    await expect(engine.getRun("run_cancel_overlap_first")).resolves.toMatchObject({
      status: "canceled",
    });
    await expect(engine.getRun("run_cancel_overlap_second")).resolves.toMatchObject({
      status: "pending",
      availableAt: Temporal.Instant.from("2026-06-11T12:00:00Z"),
      idempotencyKey: "schedule:cancel-overlap:2026-06-11T12:00:00Z",
    });
  });
});
