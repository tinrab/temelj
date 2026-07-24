import { describe, expect, test } from "vitest";

import type { TimeoutHandle } from "../../src/timer.ts";
import type { StreamUpdate } from "../../src/types/stream.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowRunNotFoundError } from "../../src/errors/mod.ts";

describe("workflow stream waiters", () => {
  test("stops following when aborted", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_stream_follow_abort" });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-follow-abort" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
      },
    );

    await engine.runWorkflowNow(workflow, undefined);

    const controller = new AbortController();
    const updates = collectStreamUpdates(
      engine.followStream<string>("run_stream_follow_abort", "log", {
        fromTail: 0,
        pollInterval: Temporal.Duration.from({ milliseconds: 1000 }),
        signal: controller.signal,
      }),
    );
    controller.abort();

    await expect(updates).resolves.toEqual([]);
  });

  test("waits for stream creation, next chunk, and terminal state", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_waiters",
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-waiters" },
      async ({ step }) => {
        await step.task.sleep("before-stream", Temporal.Duration.from({ seconds: 1 }));
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await step.task.sleep("before-second", Temporal.Duration.from({ seconds: 1 }));
        await stream.write("two");
        await stream.close();
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    const created = client.streams.wait("run_stream_waiters", "log", {
      pollInterval: Temporal.Duration.from({ milliseconds: 1 }),
    });
    now = Temporal.Instant.from("2026-06-11T10:00:02Z");
    await expect(engine.resumeWorkflow(workflow, "run_stream_waiters")).resolves.toMatchObject({
      kind: "waiting",
    });
    await expect(created).resolves.toMatchObject({
      status: "open",
      chunkCount: 0,
    });

    const nextChunk = client.streams.waitForChunk<string>("run_stream_waiters", "log", 0, {
      pollInterval: Temporal.Duration.from({ milliseconds: 1 }),
    });
    const terminal = client.streams.waitForTerminal("run_stream_waiters", "log", {
      pollInterval: Temporal.Duration.from({ milliseconds: 1 }),
    });
    now = Temporal.Instant.from("2026-06-11T10:00:04Z");
    await engine.resumeWorkflow(workflow, "run_stream_waiters");

    await expect(nextChunk).resolves.toMatchObject({ index: 1, value: "two" });
    await expect(terminal).resolves.toMatchObject({
      status: "closed",
      chunkCount: 2,
      lastIndex: 1,
    });
  });

  test("stream waiters wake from storage changes before the poll interval", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_watch_waiter",
      now: () => now,
    });
    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-watch-waiter" },
      async ({ step }) => {
        await step.task.sleep("before-stream", Temporal.Duration.from({ seconds: 1 }));
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await step.task.sleep("before-second", Temporal.Duration.from({ seconds: 1 }));
        await stream.write("two");
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    const created = engine.waitForStream("run_stream_watch_waiter", "log", {
      pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
    });
    await Promise.resolve();
    await Promise.resolve();

    now = Temporal.Instant.from("2026-06-11T10:00:02Z");
    await engine.resumeWorkflow(workflow, "run_stream_watch_waiter");

    await expect(withTimeout(created)).resolves.toMatchObject({
      status: "open",
      chunkCount: 0,
    });

    const nextChunk = engine.waitForStreamChunk<string>("run_stream_watch_waiter", "log", 0, {
      pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
    });
    await Promise.resolve();
    await Promise.resolve();

    now = Temporal.Instant.from("2026-06-11T10:00:04Z");
    await engine.resumeWorkflow(workflow, "run_stream_watch_waiter");

    await expect(withTimeout(nextChunk)).resolves.toMatchObject({
      index: 1,
      value: "two",
    });
    await expect(engine.getStreamInfo("run_stream_watch_waiter", "log")).resolves.toMatchObject({
      chunkCount: 2,
      lastIndex: 1,
    });
  });

  test("stream waiters resolve undefined when aborted", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_stream_wait_abort" });
    const workflow = implementWorkflow<undefined, void>({ name: "stream-wait-abort" }, () => {});
    await engine.runWorkflowNow(workflow, undefined);

    const controller = new AbortController();
    const created = engine.waitForStream("run_stream_wait_abort", "log", {
      pollInterval: Temporal.Duration.from({ milliseconds: 1000 }),
      signal: controller.signal,
    });

    controller.abort();

    await expect(created).resolves.toBeUndefined();
  });

  test("stream waiters reject when a waiting run is cleaned up", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_wait_cleanup",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, void>({ name: "stream-wait-cleanup" }, () => {});

    await engine.runWorkflowNow(workflow, undefined);

    const waiting = engine.waitForStream("run_stream_wait_cleanup", "missing-stream", {
      pollInterval: Temporal.Duration.from({ milliseconds: 1 }),
    });
    await engine.cleanupRuns({
      status: "completed",
      finishedAtBefore: Temporal.Instant.from("2026-06-11T10:00:01Z"),
    });

    await expect(waiting).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
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

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: TimeoutHandle | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Timed out while waiting for workflow stream promise"));
        }, 1_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
