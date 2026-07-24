import { describe, expect, expectTypeOf, test } from "vitest";

import type { WorkflowRunHandle } from "../../src/types/client.ts";
import type { WorkflowImplementation } from "../../src/types/definition.ts";
import type { LockRecord } from "../../src/types/lock.ts";
import type { WorkflowRunRecord } from "../../src/types/run.ts";
import type {
  CreateWorkflowRuntimeOptions,
  WorkflowRuntime as WorkflowRuntimeContract,
  WorkflowRuntimeRunsApi,
} from "../../src/types/runtime.ts";
import type { ScheduleRecord } from "../../src/types/schedule.ts";

import { attachWorkflowDefinition } from "../../src/compiled-function.ts";
import { implementWorkflow, defineWorkflow } from "../../src/definition.ts";
import {
  WorkflowRuntime,
  createWorkflowRuntime,
  getWorkflowRuntimeRun,
  startWorkflowRuntimeRun,
} from "../../src/runtime.ts";

describe("workflow runtime facade", () => {
  test("creates runtimes through the public factory", () => {
    const runtime = createWorkflowRuntime();

    expect(runtime).toBeInstanceOf(WorkflowRuntime);
  });

  test("starts a registered workflow def through an explicit runtime", async () => {
    const runtime = new WorkflowRuntime();
    const def = defineWorkflow<{ readonly name: string }, string>({
      name: "runtime-def",
    });
    runtime.implementWorkflow(def, ({ input }) => `hello ${input.name}`);

    const handle = await startWorkflowRuntimeRun(runtime, def, { name: "Ada" });
    await runtime.workers.processRun(handle.runId);

    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("hello Ada");
  });

  test("starts and registers a local workflow definition", async () => {
    const runtime = new WorkflowRuntime();
    const workflow = implementWorkflow<{ readonly value: number }, number>(
      { name: "runtime-definition" },
      ({ input }) => input.value * 2,
    );

    const handle = await runtime.start(workflow, { value: 21 });
    await runtime.workers.processRun(handle.runId);

    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe(42);
  });

  test("starts a compiled workflow function", async () => {
    const runtime = new WorkflowRuntime();
    const definition = implementWorkflow<[number], number, [number]>(
      { name: "runtime-compiled-function" },
      ({ input }) => input[0] + 1,
    );
    async function increment(value: number): Promise<number> {
      return value + 1;
    }
    attachWorkflowDefinition(increment, definition);

    const handle = await startWorkflowRuntimeRun(runtime, increment, 41);
    await runtime.workers.processRun(handle.runId);

    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe(42);
  });

  test("gets an existing run as a typed run handle", async () => {
    const runtime = new WorkflowRuntime();
    const workflow = implementWorkflow<undefined, { readonly ok: boolean }>(
      { name: "runtime-get-run" },
      () => ({ ok: true }),
    );
    const started = await startWorkflowRuntimeRun(runtime, workflow, undefined);
    const handle = await runtime.runs.getHandle<{ readonly ok: boolean }>(started.runId);

    await expect(handle.status()).resolves.toBe("pending");
    await runtime.workers.processRun(handle.runId);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toEqual({
      ok: true,
    });
  });

  test("exposes core schedule operations through the runtime", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const runtime = new WorkflowRuntime({
      now: () => now,
    });
    const def = defineWorkflow<undefined, string>({ name: "runtime-schedule" });

    await expect(
      runtime.schedules.create(def, {
        id: "runtime-schedule",
        every: Temporal.Duration.from({ hours: 1 }),
        input: undefined,
        from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      }),
    ).resolves.toMatchObject({
      id: "runtime-schedule",
      nextFireAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
    });
    await expect(runtime.schedules.page({ limit: 1 })).resolves.toMatchObject({
      items: [{ id: "runtime-schedule" }],
      hasMore: false,
    });
    await expect(runtime.schedules.pause("runtime-schedule")).resolves.toMatchObject({
      status: "paused",
    });
    await expect(runtime.schedules.resume("runtime-schedule")).resolves.toMatchObject({
      status: "active",
    });
    await expect(runtime.schedules.archive("runtime-schedule")).resolves.toMatchObject({
      status: "archived",
    });
    await expect(runtime.schedules.resume("runtime-schedule")).resolves.toMatchObject({
      status: "active",
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(runtime.schedules.tick()).resolves.toMatchObject({
      ticked: 1,
      scheduleIds: ["runtime-schedule"],
    });
    await expect(
      runtime.schedules.upsert(def, {
        id: "runtime-schedule",
        every: Temporal.Duration.from({ minutes: 30 }),
        input: undefined,
        from: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      }),
    ).resolves.toMatchObject({
      id: "runtime-schedule",
      nextFireAt: Temporal.Instant.from("2026-06-11T11:30:00Z"),
      tickCount: 1,
    });
    await expect(runtime.schedules.delete("runtime-schedule")).resolves.toMatchObject({
      status: "deleted",
    });
  });

  test("exposes core lock operations through the runtime", async () => {
    const runtime = new WorkflowRuntime();

    await expect(
      runtime.locks.acquire("runtime-lock", {
        holderId: "runtime-holder",
        leaseDuration: Temporal.Duration.from({ minutes: 1 }),
      }),
    ).resolves.toMatchObject({
      key: "runtime-lock",
      holderId: "runtime-holder",
      fencingToken: 1,
    });
    await expect(runtime.locks.get("runtime-lock")).resolves.toMatchObject({
      key: "runtime-lock",
    });
    await expect(runtime.locks.list()).resolves.toMatchObject([{ key: "runtime-lock" }]);
    await expect(
      runtime.locks.release("runtime-lock", {
        holderId: "runtime-holder",
      }),
    ).resolves.toMatchObject({
      key: "runtime-lock",
      releasedAt: expect.any(Temporal.Instant),
    });
    await expect(
      runtime.locks.acquire("runtime-stale-lock", {
        holderId: "runtime-stale-holder",
        leaseDuration: Temporal.Duration.from({ milliseconds: 1 }),
        now: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      }),
    ).resolves.toMatchObject({
      key: "runtime-stale-lock",
    });
    await expect(
      runtime.locks.releaseStale("runtime-stale-lock", {
        now: Temporal.Instant.from("2026-06-11T10:00:00.001Z"),
      }),
    ).resolves.toMatchObject({
      key: "runtime-stale-lock",
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:00.001Z"),
    });
  });

  test("closes runtime-owned resources", async () => {
    const runtime = new WorkflowRuntime();

    await expect(runtime.close()).resolves.toBeUndefined();
  });

  test("passes deterministic factories through runtime options", async () => {
    const runtime = new WorkflowRuntime({
      createDeterministicUuid: () => "33333333-3333-4333-8333-333333333333",
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "runtime-deterministic-factory" },
      async ({ deterministic }) => await deterministic.uuid("uuid"),
    );

    const handle = await runtime.start(workflow, undefined);
    await runtime.workers.processRun(handle.runId);

    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("33333333-3333-4333-8333-333333333333");
  });

  test("preserves runtime helper handle output types", () => {
    const runtime = new WorkflowRuntime();
    const def = defineWorkflow<{ readonly id: string }, { readonly ok: boolean }>({
      name: "runtime-typed-def",
    });
    const workflow = implementWorkflow<{ readonly id: string }, { readonly ok: boolean }>(
      { name: "runtime-typed-definition" },
      ({ input }) => ({ ok: input.id.length > 0 }),
    );

    expectTypeOf(startWorkflowRuntimeRun(runtime, def, { id: "user_1" })).toEqualTypeOf<
      Promise<WorkflowRunHandle<{ readonly ok: boolean }>>
    >();
    expectTypeOf(startWorkflowRuntimeRun(runtime, workflow, { id: "user_1" })).toEqualTypeOf<
      Promise<WorkflowRunHandle<{ readonly ok: boolean }>>
    >();
    expectTypeOf<
      ReturnType<typeof getWorkflowRuntimeRun<{ readonly ok: boolean }>>
    >().toEqualTypeOf<Promise<WorkflowRunHandle<{ readonly ok: boolean }>>>();
    expectTypeOf<ReturnType<WorkflowRuntimeRunsApi["getHandle"]>>().toEqualTypeOf<
      Promise<WorkflowRunHandle<unknown>>
    >();
    expectTypeOf<ReturnType<typeof runtime.runs.list>>().toEqualTypeOf<
      Promise<readonly WorkflowRunRecord[]>
    >();
    expectTypeOf<CreateWorkflowRuntimeOptions>().toHaveProperty("createDeterministicRandom");
    expectTypeOf<CreateWorkflowRuntimeOptions>().toHaveProperty("createDeterministicUuid");
    expectTypeOf<CreateWorkflowRuntimeOptions>().toHaveProperty("createDeterministicBytes");
    expectTypeOf<CreateWorkflowRuntimeOptions>().toHaveProperty("engine");
    expectTypeOf<CreateWorkflowRuntimeOptions>().toHaveProperty("workerEngine");
    expectTypeOf(
      runtime.schedules.create(def, {
        id: "typed-runtime-schedule",
        every: Temporal.Duration.from({ hours: 1 }),
        input: { id: "user_1" },
      }),
    ).toEqualTypeOf<Promise<ScheduleRecord<{ readonly id: string }>>>();
    expectTypeOf(
      runtime.schedules.upsert(def, {
        id: "typed-runtime-schedule",
        every: Temporal.Duration.from({ hours: 1 }),
        input: { id: "user_1" },
      }),
    ).toEqualTypeOf<Promise<ScheduleRecord<{ readonly id: string }>>>();
    expectTypeOf<ReturnType<typeof runtime.schedules.archive>>().toEqualTypeOf<
      Promise<ScheduleRecord>
    >();
    expectTypeOf(
      runtime.locks.acquire("typed-runtime-lock", {
        holderId: "holder",
        leaseDuration: Temporal.Duration.from({ minutes: 1 }),
      }),
    ).toEqualTypeOf<Promise<LockRecord>>();
    expectTypeOf<ReturnType<typeof runtime.locks.releaseStale>>().toEqualTypeOf<
      Promise<LockRecord>
    >();
    expectTypeOf<WorkflowRuntimeContract>().toHaveProperty("runs");
    expectTypeOf<WorkflowRuntimeContract>().toHaveProperty("schedules");
    expectTypeOf<WorkflowRuntimeContract>().toHaveProperty("locks");
    expectTypeOf<WorkflowRuntimeContract>().toHaveProperty("workers");
    expectTypeOf<WorkflowRuntimeContract>().toHaveProperty("close");
    expectTypeOf<WorkflowRuntimeContract>().toHaveProperty("implementWorkflow");
    expectTypeOf<WorkflowRuntimeContract>().toHaveProperty("register");
    expectTypeOf<ReturnType<typeof runtime.close>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf(
      runtime.implementWorkflow(def, ({ input }) => ({ ok: input.id.length > 0 })),
    ).toEqualTypeOf<WorkflowImplementation<{ readonly id: string }, { readonly ok: boolean }>>();
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("client");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("engine");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("registry");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("getRun");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("listRuns");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("createSchedule");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("upsertSchedule");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("archiveSchedule");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("acquireLock");
    expectTypeOf<WorkflowRuntimeContract>().not.toHaveProperty("releaseStaleLock");
  });
});
