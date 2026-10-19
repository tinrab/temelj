import type { Storage, StorageValue, StoredValue } from "@temelj/storage";

import { describe, expect, test } from "vitest";

import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";

import { clientForEngine } from "../client/create.ts";
import { implementWorkflow } from "../definition.ts";
import {
  WorkflowOptionsError,
  WorkflowRunNotFoundError,
  WorkflowSerializationError,
} from "../errors/mod.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import { makeEventsKey } from "../store-keys.ts";
import { eventHistoryStorageValue } from "../testing/storage-values.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow stream validation", () => {
  test("rejects invalid stream read and follow chunk bounds", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_stream_bounds" });
    const client = clientForEngine(engine);

    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-bounds" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
      },
    );

    await engine.runWorkflowNow(workflow, undefined);

    await expect(
      client.streams.read("run_stream_bounds", "log", {
        fromIndex: 1,
        fromTail: 1,
      }),
    ).rejects.toThrow("Cannot include both fromIndex and fromTail");
  });

  test("stream reads and followers reject missing runs", async () => {
    const engine = createWorkflowEngine();
    const client = clientForEngine(engine);

    await expect(client.streams.getInfo("run_missing_stream", "log")).rejects.toBeInstanceOf(
      WorkflowRunNotFoundError,
    );
    await expect(client.streams.read("run_missing_stream", "log")).rejects.toBeInstanceOf(
      WorkflowRunNotFoundError,
    );
    await expect(
      collectStreamUpdates(client.streams.follow("run_missing_stream", "log")),
    ).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
    await expect(client.streams.wait("run_missing_stream", "log")).rejects.toBeInstanceOf(
      WorkflowRunNotFoundError,
    );
  });

  test("rejects corrupted stream histories with gapped or late chunks", async () => {
    const duplicateEngine = createWorkflowEngine({
      createRunId: () => "run_stream_gapped_chunk",
    });

    const duplicateClient = clientForEngine(duplicateEngine);

    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-corruption" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await stream.close();
      },
    );

    await duplicateEngine.runWorkflowNow(workflow, undefined);
    const duplicateEvents = await duplicateEngine.store.getEvents("run_stream_gapped_chunk");

    const firstChunk = duplicateEvents.find(
      (event): event is Extract<EventRecord, { readonly kind: "stream_chunk" }> =>
        event.kind === "stream_chunk",
    );

    if (firstChunk === undefined) {
      throw new Error("Expected stream chunk event");
    }

    await writeCorruptedEvents(duplicateEngine.storage, "run_stream_gapped_chunk", [
      ...duplicateEvents,
      {
        ...firstChunk,
        index: 2,
        timestamp: Temporal.Instant.from("2026-06-11T10:00:01Z"),
        chunk: "gapped",
      },
    ]);

    await expect(duplicateClient.streams.read("run_stream_gapped_chunk", "log")).rejects.toThrow(
      "non-contiguous chunk index 2; expected 1",
    );

    const lateEngine = createWorkflowEngine({ createRunId: () => "run_stream_late_chunk" });
    const lateClient = clientForEngine(lateEngine);
    await lateEngine.runWorkflowNow(workflow, undefined);
    const lateEvents = await lateEngine.store.getEvents("run_stream_late_chunk");

    const lateChunk = lateEvents.find(
      (event): event is Extract<EventRecord, { readonly kind: "stream_chunk" }> =>
        event.kind === "stream_chunk",
    );

    if (lateChunk === undefined) {
      throw new Error("Expected stream chunk event");
    }

    await writeCorruptedEvents(lateEngine.storage, "run_stream_late_chunk", [
      ...lateEvents,
      {
        ...lateChunk,
        index: 1,
        timestamp: Temporal.Instant.from("2026-06-11T10:00:02Z"),
        chunk: "late",
      },
    ]);

    await expect(lateClient.streams.getInfo("run_stream_late_chunk", "log")).rejects.toBeInstanceOf(
      WorkflowOptionsError,
    );
    await expect(lateClient.streams.getInfo("run_stream_late_chunk", "log")).rejects.toThrow(
      "chunk 1 after terminal event stream_closed",
    );
  });

  test("rejects stream chunks above the chunk limit", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_limit",
      maximumStreamChunks: 1,
    });

    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-limit" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await stream.write("two");
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected stream limit failure");
    }

    expect(result.error.message).toContain("maximumStreamChunks 1");
  });

  test("validates stream chunks with persisted value size limits", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_size_limit",
      maximumPersistedValueBytes: 10,
    });

    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-size-limit" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("this is too large");
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected stream size limit failure");
    }

    expect(result.error.message).toContain("maximumPersistedValueBytes 10");
  });

  test("rejects unserializable stream metadata before durable stream writes", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_bad_metadata",
    });

    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-bad-metadata" },
      ({ step }) => {
        step.stream.create("log", {
          id: "status",
          // @ts-expect-error Stream metadata excludes functions, and runtime validation rejects them too.
          metadata: { nested: [{ bad: () => "nope" }] },
        });
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected stream metadata serialization failure");
    }

    const error = workflowErrorFromRecord(result.error);
    expect(error).toBeInstanceOf(WorkflowSerializationError);
    expect(error.message).toContain("workflow stream status metadata.nested[0].bad");

    const streamEvents = (await engine.store.getEvents("run_stream_bad_metadata")).filter(
      (event) => event.kind === "stream_started",
    );

    expect(streamEvents).toEqual([]);
  });

  test("rejects unserializable stream chunks before durable chunk writes", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_stream_bad_chunk",
    });

    const workflow = implementWorkflow<undefined, void>(
      { name: "stream-bad-chunk" },
      async ({ step }) => {
        const stream = step.stream.create("log", { id: "status" });
        await stream.write({ items: new Set([Symbol("nope")]) });
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected stream chunk serialization failure");
    }

    const error = workflowErrorFromRecord(result.error);
    expect(error).toBeInstanceOf(WorkflowSerializationError);
    expect(error.message).toContain("workflow stream status chunk.items.<value:0>");
    const events = await engine.store.getEvents("run_stream_bad_chunk");
    expect(events.filter((event) => event.kind === "stream_started")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "stream_chunk")).toEqual([]);
  });
});

async function collectStreamUpdates(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const updates: unknown[] = [];

  for await (const update of iterable) {
    updates.push(update);
  }

  return updates;
}

async function writeCorruptedEvents(
  storage: Storage<Record<string, StorageValue>, StorageValue, StoredValue>,
  runId: RunId,
  events: readonly EventRecord[],
): Promise<void> {
  await storage.set(makeEventsKey("default", runId), eventHistoryStorageValue(events));
}
