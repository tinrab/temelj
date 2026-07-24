import { describe, expect, expectTypeOf, test } from "vitest";

import type { WorkflowRunHandle } from "../../src/types/client.ts";
import type { StreamChunk, StreamState, StreamUpdate } from "../../src/types/stream.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowRuntime } from "../../src/runtime.ts";

describe("workflow streams", () => {
  test("persists stream chunks across replay without duplicates", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_replay",
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, string>(
      { name: "stream-replay" },
      async ({ step }) => {
        const stream = step.stream.create<{ readonly text: string }>("updates", {
          contentType: "application/json",
          metadata: { channel: "status" },
        });
        await stream.write({ text: "started" });
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        await stream.write({ text: "finished" });
        await stream.close();
        return "done";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-11T10:00:02Z");
    await expect(engine.resumeWorkflow(workflow, "run_stream_replay")).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    const stream = await client.streams.read<{ readonly text: string }>(
      "run_stream_replay",
      "updates",
    );
    expect(stream).toMatchObject({
      id: "updates",
      name: "updates",
      status: "closed",
      contentType: "application/json",
      metadata: { channel: "status" },
      chunks: [
        { index: 0, value: { text: "started" } },
        { index: 1, value: { text: "finished" } },
      ],
    });
    const streamEvents = (await engine.getEvents("run_stream_replay")).filter((event) =>
      event.kind.startsWith("stream_"),
    );
    expect(streamEvents.map((event) => event.kind)).toEqual([
      "stream_started",
      "stream_chunk",
      "stream_chunk",
      "stream_closed",
    ]);
  });

  test("rejects stream chunk replay divergence", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_chunk_divergence",
      now: () => now,
    });
    let firstChunk = "started";
    const workflow = implementWorkflow<undefined, string>(
      { name: "stream-chunk-divergence" },
      async ({ step }) => {
        const stream = step.stream.create<string>("updates");
        await stream.write(firstChunk);
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        await stream.close();
        return "done";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    firstChunk = "changed";
    now = Temporal.Instant.from("2026-06-11T10:00:02Z");
    const result = await engine.resumeWorkflow(workflow, "run_stream_chunk_divergence");

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected stream replay divergence");
    }
    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
    await expect(engine.getRun("run_stream_chunk_divergence")).resolves.toMatchObject({
      status: "failed",
      error: { name: "WorkflowReplayDivergenceError" },
    });
  });

  test("reads stream chunks from an offset", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_stream_offset" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-offset" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await stream.write("two");
        await stream.write("three");
        await stream.close();
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
    });

    const stream = await client.streams.read<string>("run_stream_offset", "log", { fromIndex: 1 });
    expect(stream.chunks.map((chunk) => chunk.value)).toEqual(["two", "three"]);

    const bounded = await client.streams.read<string>("run_stream_offset", "log", {
      fromIndex: 0,
      maxChunks: 2,
    });
    expect(bounded.chunkCount).toBe(3);
    expect(bounded.chunks.map((chunk) => chunk.value)).toEqual(["one", "two"]);
  });

  test("persists stream error state", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_stream_error" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-error" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("before-error");
        await stream.error(new Error("stream failed"));
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
    });

    const stream = await client.streams.read<string>("run_stream_error", "log");
    expect(stream.status).toBe("failed");
    expect(stream.error).toMatchObject({ name: "Error", message: "stream failed" });
    expect(stream.chunks.map((chunk) => chunk.value)).toEqual(["before-error"]);
  });

  test("follows a completed stream from persisted chunks through terminal state", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_stream_follow_completed" });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-follow-completed" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await stream.write("two");
        await stream.close();
      },
    );

    await engine.runWorkflowNow(workflow, undefined);

    const updates = await collectStreamUpdates(
      engine.followStream<string>("run_stream_follow_completed", "log"),
    );
    expect(updates).toMatchObject([
      { kind: "chunk", chunk: { index: 0, value: "one" } },
      { kind: "chunk", chunk: { index: 1, value: "two" } },
      { kind: "closed", info: { status: "closed", chunkCount: 2, lastIndex: 1 } },
    ]);

    const pagedUpdates = await collectStreamUpdates(
      engine.followStream<string>("run_stream_follow_completed", "log", { pageSize: 1 }),
    );
    expect(pagedUpdates).toMatchObject([
      { kind: "chunk", chunk: { index: 0, value: "one" } },
      { kind: "chunk", chunk: { index: 1, value: "two" } },
      { kind: "closed", info: { status: "closed", chunkCount: 2, lastIndex: 1 } },
    ]);
  });

  test("exposes stream readers and followers on run handles", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_stream_handle" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-handle" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await stream.write("two");
        await stream.close();
      },
    );

    const handle = await client.runs.start(workflow, undefined);
    await engine.resumeWorkflow(workflow, handle.runId);
    await expect(handle.getStreamInfo("log")).resolves.toMatchObject({
      status: "closed",
      chunkCount: 2,
    });
    await expect(handle.readStream<string>("log", { fromIndex: 1 })).resolves.toMatchObject({
      chunks: [{ index: 1, value: "two" }],
    });
    await expect(collectStreamUpdates(handle.followStream<string>("log"))).resolves.toMatchObject([
      { kind: "chunk", chunk: { index: 0, value: "one" } },
      { kind: "chunk", chunk: { index: 1, value: "two" } },
      { kind: "closed", info: { status: "closed", chunkCount: 2 } },
    ]);

    const runtime = new WorkflowRuntime();
    const runtimeHandle = await runtime.start(workflow);
    await runtime.workers.processRun(runtimeHandle.runId);

    await expect(runtimeHandle.readStream<string>("log")).resolves.toMatchObject({
      chunks: [
        { index: 0, value: "one" },
        { index: 1, value: "two" },
      ],
    });
  });

  test("follows an open stream until later chunks close it", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_follow_live",
      now: () => now,
    });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-follow-live" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        await stream.write("two");
        await stream.close();
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    const updates = collectStreamUpdates(
      engine.followStream<string>("run_stream_follow_live", "log", {
        pollInterval: Temporal.Duration.from({ milliseconds: 1 }),
      }),
    );
    await waitFor(
      async () => (await engine.readStream("run_stream_follow_live", "log")).chunkCount === 1,
    );

    now = Temporal.Instant.from("2026-06-11T10:00:02Z");
    await engine.resumeWorkflow(workflow, "run_stream_follow_live");

    await expect(updates).resolves.toMatchObject([
      { kind: "chunk", chunk: { index: 0, value: "one" } },
      { kind: "chunk", chunk: { index: 1, value: "two" } },
      { kind: "closed", info: { status: "closed", chunkCount: 2, lastIndex: 1 } },
    ]);
  });

  test("summarizes active streams from durable events", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_summary",
      now: () => now,
    });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-summary" },
      async ({ step }) => {
        const stream = step.stream.create<string>("updates", { id: "status" });
        await stream.write("one");
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        await stream.close();
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    await expect(engine.getRunSummary()).resolves.toMatchObject({
      stream: {
        activeStreams: 1,
        activeStreamRuns: 1,
        streamRunIds: ["run_stream_summary"],
        streamStepIds: ["stream:updates"],
        streamIds: ["status"],
        streamNames: ["updates"],
        chunkCount: 1,
        oldestStartedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      },
    });

    now = Temporal.Instant.from("2026-06-11T10:00:02Z");
    await engine.resumeWorkflow(workflow, "run_stream_summary");

    await expect(engine.getRunSummary()).resolves.not.toHaveProperty("stream");
  });

  test("follows failed streams and can start from the current tail", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_stream_follow_failed" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-follow-failed" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("before-error");
        await stream.error(new Error("failed stream"));
      },
    );

    await engine.runWorkflowNow(workflow, undefined);

    const updates = await collectStreamUpdates(
      client.streams.follow<string>("run_stream_follow_failed", "log", { fromTail: 0 }),
    );
    expect(updates).toMatchObject([
      {
        kind: "failed",
        info: { status: "failed", chunkCount: 1, error: { message: "failed stream" } },
      },
    ]);
  });

  test("exposes stream types through the step and client APIs", () => {
    implementWorkflow<undefined, void>({ name: "stream-types" }, ({ step }) => {
      const stream = step.stream.create<{ readonly text: string }>("updates");
      expectTypeOf(stream.id).toEqualTypeOf<string>();
      expectTypeOf(stream.write({ text: "ok" })).toEqualTypeOf<Promise<void>>();
    });
    const client = createWorkflowClient();
    expectTypeOf<ReturnType<typeof client.streams.read<{ readonly text: string }>>>().toEqualTypeOf<
      Promise<StreamState<{ readonly text: string }>>
    >();
    expectTypeOf<
      ReturnType<typeof client.streams.follow<{ readonly text: string }>>
    >().toEqualTypeOf<AsyncIterable<StreamUpdate<{ readonly text: string }>>>();
    expectTypeOf<
      ReturnType<typeof client.streams.waitForChunk<{ readonly text: string }>>
    >().toEqualTypeOf<Promise<StreamChunk<{ readonly text: string }> | undefined>>();
    expectTypeOf<ReturnType<WorkflowRunHandle["readStream"]>>().toEqualTypeOf<
      Promise<StreamState<unknown>>
    >();
    expectTypeOf<ReturnType<WorkflowRunHandle["followStream"]>>().toEqualTypeOf<
      AsyncIterable<StreamUpdate<unknown>>
    >();
  });
});

async function collectStreamUpdates<TChunk>(
  iterable: AsyncIterable<StreamUpdate<TChunk>>,
): Promise<StreamUpdate<TChunk>[]> {
  const updates: StreamUpdate<TChunk>[] = [];
  for await (const update of iterable) {
    updates.push(update);
  }
  return updates;
}

async function waitFor(callback: () => Promise<boolean>): Promise<void> {
  const startedAt = Temporal.Now.instant();
  while (!(await callback())) {
    if (Temporal.Now.instant().epochMilliseconds - startedAt.epochMilliseconds > 1_000) {
      throw new Error("Timed out while waiting for workflow stream test condition");
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }
}
