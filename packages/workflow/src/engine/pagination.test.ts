import { describe, expect, it } from "vitest";

import { clientForEngine } from "../client/create.ts";
import { implementWorkflow } from "../definition.ts";
import { WorkflowOptionsError } from "../errors/mod.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow pagination", () => {
  it("pages runs with stable createdAt and run id ordering", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2025-01-01T00:00:00Z"),
    });

    const workflow = implementWorkflow({ name: "paged-runs" }, () => "ok");

    await engine.runWorkflow(workflow, undefined, { start: { id: "run-c" } });
    await engine.runWorkflow(workflow, undefined, { start: { id: "run-a" } });
    await engine.runWorkflow(workflow, undefined, { start: { id: "run-b" } });

    const first = await engine.store.listRunsPage({ workflowName: "paged-runs", limit: 2 });
    expect(first.items.map((run) => run.id)).toEqual(["run-a", "run-b"]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await engine.store.listRunsPage({
      workflowName: "paged-runs",
      cursor: first.nextCursor,
      limit: 2,
    });

    expect(second.items.map((run) => run.id)).toEqual(["run-c"]);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeUndefined();
  });

  it("pages step attempts and windows stream chunks", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-pages" });
    const client = clientForEngine(engine);

    const workflow = implementWorkflow({ name: "paged-history" }, async ({ step }) => {
      const stream = step.stream.create<string>("progress");
      await stream.write("one");
      await stream.write("two");
      await stream.write("three");
      await stream.close();

      return "done";
    });

    await engine.runWorkflowNow(workflow, undefined);

    const attempts = await client.runs.listStepAttempts("run-pages", { limit: 1 });
    expect(attempts.items).toMatchObject([{ stepName: "progress", status: "completed" }]);
    expect(attempts.hasMore).toBe(false);

    const stream = await client.streams.read("run-pages", "progress", {
      maxChunks: 2,
    });

    expect(stream.chunks.map((chunk) => chunk.value)).toEqual(["one", "two"]);

    const nextStream = await client.streams.read("run-pages", "progress", {
      fromIndex: stream.chunks.length,
      maxChunks: 2,
    });

    expect(nextStream.chunks.map((chunk) => chunk.value)).toEqual(["three"]);
  });

  it("inspects stream info and reads chunks from the current tail", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-stream-info" });
    const client = clientForEngine(engine);

    const workflow = implementWorkflow({ name: "stream-info" }, async ({ step }) => {
      const stream = step.stream.create<string>("progress", {
        id: "progress-stream",
        contentType: "text/plain",
        metadata: { purpose: "status" },
      });

      await stream.write("one");
      await stream.write("two");
      await stream.write("three");
      await stream.close();

      return "done";
    });

    await engine.runWorkflowNow(workflow, undefined);

    await expect(client.streams.getInfo("run-stream-info", "missing")).rejects.toBeInstanceOf(
      WorkflowOptionsError,
    );

    const info = await client.streams.getInfo("run-stream-info", "progress");
    expect(info).toMatchObject({
      runId: "run-stream-info",
      id: "progress-stream",
      name: "progress",
      status: "closed",
      contentType: "text/plain",
      metadata: { purpose: "status" },
      chunkCount: 3,
      lastIndex: 2,
    });

    const tail = await client.streams.read("run-stream-info", "progress-stream", {
      fromTail: 2,
    });

    expect(tail.chunkCount).toBe(3);
    expect(tail.lastIndex).toBe(2);
    expect(tail.chunks.map((chunk) => chunk.value)).toEqual(["two", "three"]);

    const tailWindow = await client.streams.read("run-stream-info", "progress", {
      fromTail: 2,
      maxChunks: 1,
    });

    expect(tailWindow.chunks.map((chunk) => chunk.value)).toEqual(["two"]);

    await expect(
      client.streams.read("run-stream-info", "progress", {
        fromIndex: 1,
        fromTail: 1,
      }),
    ).rejects.toThrow("Cannot include both fromIndex and fromTail");
  });

  it("reports open and failed stream info", async () => {
    const engine = createWorkflowEngine();
    const client = clientForEngine(engine);

    const openWorkflow = implementWorkflow({ name: "open-stream-info" }, async ({ step }) => {
      const stream = step.stream.create<string>("progress");
      await stream.write("one");

      return "done";
    });

    const failedWorkflow = implementWorkflow({ name: "failed-stream-info" }, async ({ step }) => {
      const stream = step.stream.create<string>("progress");
      await stream.write("one");
      await stream.error(new Error("stream failed"));

      return "done";
    });

    await engine.runWorkflowNow(openWorkflow, undefined, { start: { id: "run-open-stream" } });
    await engine.runWorkflowNow(failedWorkflow, undefined, { start: { id: "run-failed-stream" } });

    await expect(client.streams.getInfo("run-open-stream", "progress")).resolves.toMatchObject({
      status: "open",
      chunkCount: 1,
      lastIndex: 0,
    });
    await expect(client.streams.getInfo("run-failed-stream", "progress")).resolves.toMatchObject({
      status: "failed",
      chunkCount: 1,
      lastIndex: 0,
      error: { message: "stream failed" },
    });
  });

  it("keeps run cursors stable when earlier runs are cleaned up", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2025-01-01T00:00:00Z"),
    });

    const client = clientForEngine(engine);

    const workflow = implementWorkflow({ name: "cleanup-pages" }, () => "ok");

    await engine.runWorkflowNow(workflow, undefined, { start: { id: "run-a" } });
    await engine.runWorkflowNow(workflow, undefined, { start: { id: "run-b" } });
    await engine.runWorkflowNow(workflow, undefined, { start: { id: "run-c" } });

    const first = await engine.store.listRunsPage({ workflowName: "cleanup-pages", limit: 1 });
    expect(first.items.map((run) => run.id)).toEqual(["run-a"]);

    await client.admin.cleanup({
      finishedAtBefore: Temporal.Instant.from("2025-01-01T00:00:01Z"),
      status: "completed",
      workflowName: "cleanup-pages",
      limit: 1,
    });

    const second = await engine.store.listRunsPage({
      workflowName: "cleanup-pages",
      cursor: first.nextCursor,
      limit: 10,
    });

    expect(second.items.map((run) => run.id)).toEqual(["run-b", "run-c"]);
  });

  it("rejects invalid cursors", async () => {
    const engine = createWorkflowEngine();

    await expect(engine.store.listRunsPage({ cursor: "not-a-cursor" })).rejects.toBeInstanceOf(
      WorkflowOptionsError,
    );
  });
});
