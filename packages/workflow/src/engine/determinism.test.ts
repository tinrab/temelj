import { describe, expect, expectTypeOf, test } from "vitest";

import { clientForEngine } from "../client/create.ts";
import { implementWorkflow } from "../definition.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow deterministic helpers", () => {
  test.each(["clock", "id"] as const)("rejects replaying a random value as %s", async (helper) => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    let replay = false;
    const engine = createWorkflowEngine({ now: () => now, createDeterministicRandom: () => 0.5 });

    const workflow = implementWorkflow({ name: "changed-deterministic-kind" }, async ({ step }) => {
      const value = replay
        ? helper === "clock"
          ? await step.deterministic.now("shared")
          : await step.deterministic.recordedId("shared")
        : await step.deterministic.random("shared");

      await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));

      return value;
    });

    const initial = await engine.runWorkflowNow(workflow, undefined);
    expect(initial.kind).toBe("waiting");
    now = now.add({ seconds: 1 });
    replay = true;
    await expect(engine.resumeWorkflow(workflow, initial.run.id)).resolves.toMatchObject({
      kind: "failed",
      error: { name: "WorkflowReplayDivergenceError" },
    });
  });

  test("exposes typed deterministic helper outputs", () => {
    const workflow = implementWorkflow<undefined, void>(
      { name: "deterministic-types" },
      ({ step }) => {
        expectTypeOf(step.deterministic.now("clock")).toEqualTypeOf<Promise<Temporal.Instant>>();
        expectTypeOf(step.deterministic.random("roll")).toEqualTypeOf<Promise<number>>();
        expectTypeOf(step.deterministic.recordedId("token")).toEqualTypeOf<Promise<string>>();
        expectTypeOf(step.deterministic.id("token")).toEqualTypeOf<Promise<string>>();
        expectTypeOf(step.deterministic.uuid("uuid")).toEqualTypeOf<Promise<string>>();
        expectTypeOf(step.deterministic.bytes("nonce", 16)).toEqualTypeOf<Promise<Uint8Array>>();
      },
    );

    expect(workflow.name).toBe("deterministic-types");
  });

  test("replays deterministic now, random, and recorded ID values from history", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");

    const engine = createWorkflowEngine({
      createRunId: () => "run_deterministic_replay",
      now: () => now,
    });

    const client = clientForEngine(engine);

    const workflow = implementWorkflow<
      undefined,
      {
        readonly firstNow: string;
        readonly secondNow: string;
        readonly firstRandom: number;
        readonly secondRandom: number;
        readonly firstUuid: string;
        readonly secondUuid: string;
        readonly firstBytes: readonly number[];
        readonly secondBytes: readonly number[];
      }
    >({ name: "deterministic-replay" }, async ({ step }) => {
      const firstNow = await step.deterministic.now("clock");
      const firstRandom = await step.deterministic.random("roll");
      const firstUuid = await step.deterministic.uuid("uuid");
      const firstBytes = await step.deterministic.bytes("nonce", 4);
      await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      const secondNow = await step.deterministic.now("clock-after");
      const secondRandom = await step.deterministic.random("roll-after");
      const secondUuid = await step.deterministic.uuid("uuid-after");
      const secondBytes = await step.deterministic.bytes("nonce-after", 4);

      return {
        firstNow: firstNow.toString(),
        secondNow: secondNow.toString(),
        firstRandom,
        secondRandom,
        firstUuid,
        secondUuid,
        firstBytes: [...firstBytes],
        secondBytes: [...secondBytes],
      };
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const result = await engine.resumeWorkflow(workflow, "run_deterministic_replay");

    expect(result).toMatchObject({
      kind: "completed",
      output: {
        firstNow: "2026-06-11T10:00:00Z",
        secondNow: "2026-06-11T10:00:01Z",
      },
    });

    if (result.kind !== "completed") {
      throw new Error("Expected workflow to complete");
    }

    expect(result.output.firstRandom).toBeGreaterThanOrEqual(0);
    expect(result.output.firstRandom).toBeLessThan(1);
    expect(result.output.secondRandom).toBeGreaterThanOrEqual(0);
    expect(result.output.secondRandom).toBeLessThan(1);
    expect(result.output.firstUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(result.output.secondUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(result.output.firstBytes).toHaveLength(4);
    expect(result.output.secondBytes).toHaveLength(4);

    await expect(engine.store.getEvents("run_deterministic_replay")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:clock",
          stepName: "clock",
          value: Temporal.Instant.from("2026-06-11T10:00:00Z"),
        }),
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:roll",
          stepName: "roll",
        }),
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:uuid",
          stepName: "uuid",
        }),
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:nonce",
          stepName: "nonce",
        }),
        expect.objectContaining({ kind: "sleep_started", stepId: "sleep:pause" }),
        expect.objectContaining({ kind: "sleep_completed", stepId: "sleep:pause" }),
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:clock-after",
          stepName: "clock-after",
          value: Temporal.Instant.from("2026-06-11T10:00:01Z"),
        }),
      ]),
    );
    await expect(engine.store.listStepAttempts("run_deterministic_replay")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic",
          status: "completed",
          stepId: "deterministic:clock",
          output: Temporal.Instant.from("2026-06-11T10:00:00Z"),
        }),
      ]),
    );
    const timeline = await client.runs.timeline("run_deterministic_replay");
    expect(timeline.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic",
          status: "recorded",
          event: expect.objectContaining({
            stepId: "deterministic:clock",
            value: Temporal.Instant.from("2026-06-11T10:00:00Z"),
          }),
        }),
      ]),
    );
  });

  test("uses the configured recorded ID generator for first-recorded ids", async () => {
    const engine = createWorkflowEngine({
      createRecordedId: ({ commandCount, commandId, commandName, runId }) =>
        `${runId}:${commandId}:${commandName}:${commandCount}`,
      createRunId: () => "run_configured_recorded_id",
    });

    const workflow = implementWorkflow<undefined, string>(
      { name: "configured-recorded-id" },
      async ({ step }) => await step.deterministic.recordedId("token"),
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result).toMatchObject({
      kind: "completed",
      output: "run_configured_recorded_id:deterministic:token:token:1",
    });
    await expect(engine.store.getEvents("run_configured_recorded_id")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          value: "run_configured_recorded_id:deterministic:token:token:1",
        }),
      ]),
    );
  });

  test("records uuid and bytes from configured factories only once", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    let uuidCalls = 0;
    let bytesCalls = 0;

    const engine = createWorkflowEngine({
      createDeterministicUuid: () => {
        uuidCalls++;

        return "11111111-1111-4111-8111-111111111111";
      },
      createDeterministicBytes: ({ length }) => {
        bytesCalls++;

        return Uint8Array.from({ length }, (_, index) => index + 1);
      },
      createRunId: () => "run_configured_uuid_bytes",
      now: () => now,
    });

    const workflow = implementWorkflow<
      undefined,
      { readonly uuid: string; readonly bytes: readonly number[] }
    >({ name: "configured-uuid-bytes" }, async ({ step }) => {
      const uuid = await step.deterministic.uuid("uuid");
      const bytes = await step.deterministic.bytes("bytes", 3);
      await step.sleep("pause", Temporal.Duration.from({ milliseconds: 1 }));

      return { uuid, bytes: [...bytes] };
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-11T10:00:00.001Z");
    const result = await engine.resumeWorkflow(workflow, "run_configured_uuid_bytes");

    expect(result).toMatchObject({
      kind: "completed",
      output: {
        uuid: "11111111-1111-4111-8111-111111111111",
        bytes: [1, 2, 3],
      },
    });
    expect(uuidCalls).toBe(1);
    expect(bytesCalls).toBe(1);
    await expect(engine.store.getEvents("run_configured_uuid_bytes")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:uuid",
          value: "11111111-1111-4111-8111-111111111111",
        }),
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:bytes",
          value: new Uint8Array([1, 2, 3]),
        }),
      ]),
    );
  });

  test("returns fresh deterministic byte arrays", async () => {
    const engine = createWorkflowEngine({
      createDeterministicBytes: () => new Uint8Array([1, 2]),
      createRunId: () => "run_fresh_bytes",
    });

    const workflow = implementWorkflow<undefined, readonly number[]>(
      { name: "fresh-bytes" },
      async ({ step }) => {
        const first = await step.deterministic.bytes("bytes", 2);
        first[0] = 9;
        const second = await step.deterministic.bytes("bytes", 2);

        return [...second];
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: [1, 2],
    });
    await expect(engine.store.getEvents("run_fresh_bytes")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:bytes",
          value: new Uint8Array([1, 2]),
        }),
      ]),
    );
  });

  test("rejects deterministic bytes replay length changes", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    let length = 2;

    const engine = createWorkflowEngine({
      createDeterministicBytes: ({ length }) => new Uint8Array(length),
      createRunId: () => "run_bytes_length_divergence",
      now: () => now,
    });

    const workflow = implementWorkflow<undefined, number>(
      { name: "bytes-length-divergence" },
      async ({ step }) => {
        const bytes = await step.deterministic.bytes("bytes", length);
        await step.sleep("pause", Temporal.Duration.from({ milliseconds: 1 }));

        return bytes.byteLength;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    length = 3;
    now = Temporal.Instant.from("2026-06-11T10:00:00.001Z");
    const result = await engine.resumeWorkflow(workflow, "run_bytes_length_divergence");

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }

    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
  });

  test("enforces deterministic bytes persisted value limits", async () => {
    const engine = createWorkflowEngine({
      createDeterministicBytes: ({ length }) => new Uint8Array(length),
      createRunId: () => "run_bytes_size_limit",
      maximumPersistedValueBytes: 1,
    });

    const workflow = implementWorkflow<undefined, Uint8Array>(
      { name: "bytes-size-limit" },
      async ({ step }) => await step.deterministic.bytes("bytes", 16),
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }

    expect(result.error.name).toBe("WorkflowSerializationError");
  });

  test("default deterministic bytes generator supports Web Crypto chunking limits", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_large_default_bytes",
    });

    const workflow = implementWorkflow<undefined, number>(
      { name: "large-default-bytes" },
      async ({ step }) => {
        const bytes = await step.deterministic.bytes("bytes", 70_000);

        return bytes.byteLength;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: 70_000,
    });
    await expect(engine.store.getEvents("run_large_default_bytes")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:bytes",
          value: expect.any(Uint8Array),
        }),
      ]),
    );
  });

  test.each([
    {
      helper: "random",
      options: { createDeterministicRandom: () => 2 },
      expected: "a finite number in [0, 1)",
    },
    {
      helper: "uuid",
      options: { createDeterministicUuid: () => "not-a-uuid" },
      expected: "a UUID string",
    },
  ] as const)("rejects invalid generated $helper values before recording them", async (input) => {
    const engine = createWorkflowEngine({
      ...input.options,
      createRunId: () => "run_invalid_value",
    });

    const workflow = implementWorkflow<undefined, unknown>(
      { name: `invalid-${input.helper}` },
      async ({ step }) => await step.deterministic[input.helper](),
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "failed",
      error: { message: expect.stringContaining(input.expected) },
    });
    await expect(engine.store.getEvents("run_invalid_value")).resolves.not.toContainEqual(
      expect.objectContaining({ kind: "deterministic_value_recorded" }),
    );
  });

  test("rejects invalid generated recorded IDs before recording them", async () => {
    const engine = createWorkflowEngine({
      // @ts-expect-error Simulates a JavaScript generator that breaks its declared return type.
      createRecordedId: () => 42,
      createRunId: () => "run_invalid_recorded_id",
    });

    const workflow = implementWorkflow<undefined, string>(
      { name: "invalid-recorded-id" },
      async ({ step }) => await step.deterministic.recordedId(),
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "failed",
      error: { message: expect.stringContaining("a recorded ID string") },
    });
  });

  test("keeps id as a recorded ID alias", async () => {
    const engine = createWorkflowEngine({
      createRecordedId: ({ commandId, runId }) => `${runId}:${commandId}`,
      createRunId: () => "run_recorded_id_alias",
    });

    const workflow = implementWorkflow<undefined, string>(
      { name: "recorded-id-alias" },
      async ({ step }) => await step.deterministic.id("token"),
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "run_recorded_id_alias:deterministic:token",
    });
  });

  test("rejects renamed deterministic helper replay divergence", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");

    const engine = createWorkflowEngine({
      createRunId: () => "run_deterministic_rename_divergence",
      now: () => now,
    });

    let name = "clock";

    const workflow = implementWorkflow<undefined, string>(
      { name: "deterministic-rename-divergence" },
      async ({ step }) => {
        const value = await step.deterministic.now(name);
        await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));

        return value.toString();
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    name = "renamed-clock";
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const result = await engine.resumeWorkflow(workflow, "run_deterministic_rename_divergence");

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }

    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
  });

  test("rejects reordered deterministic helper replay divergence", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");

    const engine = createWorkflowEngine({
      createRunId: () => "run_deterministic_reorder_divergence",
      now: () => now,
    });

    let reverse = false;

    const workflow = implementWorkflow<undefined, readonly string[]>(
      { name: "deterministic-reorder-divergence" },
      async ({ step }) => {
        if (reverse) {
          const right = await step.deterministic.recordedId("right");
          const left = await step.deterministic.recordedId("left");
          await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));

          return [right, left];
        }

        const left = await step.deterministic.recordedId("left");
        const right = await step.deterministic.recordedId("right");
        await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));

        return [left, right];
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    reverse = true;
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const result = await engine.resumeWorkflow(workflow, "run_deterministic_reorder_divergence");

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }

    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
  });

  test("rejects nondurable control-flow changes across replay", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");

    const engine = createWorkflowEngine({
      createRunId: () => "run_nondurable_branch_divergence",
      now: () => now,
    });

    let includeStep = true;

    const workflow = implementWorkflow<undefined, string>(
      { name: "nondurable-branch-divergence" },
      async ({ step }) => {
        if (includeStep) {
          await step.run({ name: "branch" }, () => "branch");
        }

        await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));

        return "done";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    includeStep = false;
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const result = await engine.resumeWorkflow(workflow, "run_nondurable_branch_divergence");

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }

    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
    await expect(engine.store.getRun("run_nondurable_branch_divergence")).resolves.toMatchObject({
      status: "failed",
      error: { name: "WorkflowReplayDivergenceError" },
    });
  });

  test("passes deterministic values into durable task callbacks", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");

    const engine = createWorkflowEngine({
      createRunId: () => "run_deterministic_task_input",
      createDeterministicUuid: () => "22222222-2222-4222-8222-222222222222",
      now: () => now,
    });

    let taskCalls = 0;

    const workflow = implementWorkflow<undefined, string>(
      { name: "deterministic-task-input" },
      async ({ step }) => {
        const id = await step.deterministic.uuid("task-id");

        const result = await step.run({ name: "task" }, () => {
          taskCalls++;

          return `saved:${id}`;
        });

        await step.sleep("pause", Temporal.Duration.from({ milliseconds: 1 }));

        return result;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-11T10:00:00.001Z");
    await expect(
      engine.resumeWorkflow(workflow, "run_deterministic_task_input"),
    ).resolves.toMatchObject({
      kind: "completed",
      output: "saved:22222222-2222-4222-8222-222222222222",
    });
    expect(taskCalls).toBe(1);
  });
});
