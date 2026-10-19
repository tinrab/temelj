import { describe, expect, test } from "vitest";

import type { EventRecord } from "../types/events.ts";
import type { WorkflowStore } from "../types/store.ts";

import { WorkflowMessageIdempotencyConflictError } from "../errors/mod.ts";
import { makeEventsKey, makeMessageIdempotencyKey } from "../store-keys.ts";
import { pendingRun, storeFactories } from "../testing/store-contract.ts";
import { toStorageValue } from "./storage-value.ts";

interface StoreContractOptions {
  readonly name: string;
  readonly createStore: () => WorkflowStore | Promise<WorkflowStore>;
}

function describeMessageIdempotencyContract(options: StoreContractOptions): void {
  describe(`${options.name}`, () => {
    test("enforces messageId idempotency and detects conflicting duplicates", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-messageId"));

      const messageId: EventRecord = {
        kind: "message_sent",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        messageId: "ready",
        payload: "one",
        idempotencyKey: "messageId-key",
      };

      await expect(store.appendEvent(run.id, messageId)).resolves.toEqual([messageId]);
      await expect(store.appendEvent(run.id, { ...messageId })).resolves.toEqual([messageId]);
      await expect(
        store.appendEvent(run.id, {
          ...messageId,
          timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
          payload: "two",
        }),
      ).rejects.toBeInstanceOf(WorkflowMessageIdempotencyConflictError);
    });

    test("reports conflicts for incomparable calendar-duration payloads", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-calendar-duration-message"));

      const message: EventRecord = {
        kind: "message_sent",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        messageId: "calendar-duration",
        payload: { duration: Temporal.Duration.from("P1M") },
        idempotencyKey: "calendar-duration-key",
      };

      await expect(store.appendEvent(run.id, message)).resolves.toEqual([message]);
      await expect(store.appendEvent(run.id, { ...message })).resolves.toEqual([message]);
      await expect(
        store.appendEvent(run.id, {
          ...message,
          payload: { duration: Temporal.Duration.from("P30D") },
        }),
      ).rejects.toBeInstanceOf(WorkflowMessageIdempotencyConflictError);
    });

    test("does not roll back existing events when duplicate message index repair conflicts", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-messageId-index-conflict"));

      const messageId: EventRecord = {
        kind: "message_sent",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        messageId: "ready",
        payload: "one",
        idempotencyKey: "messageId-key",
      };

      await expect(store.appendEvent(run.id, messageId)).resolves.toEqual([messageId]);
      await store.storage.set(
        makeMessageIdempotencyKey(store.namespace, run.id, "messageId-key"),
        toStorageValue({
          runId: run.id,
          messageId: "other-message",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        }),
      );

      await expect(store.appendEvent(run.id, { ...messageId })).rejects.toBeInstanceOf(
        WorkflowMessageIdempotencyConflictError,
      );
      await expect(store.getEvents(run.id)).resolves.toEqual([messageId]);
    });

    test("repairs message idempotency indexes from durable event history", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-messageId-repair"));

      const messageId: EventRecord = {
        kind: "message_sent",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        messageId: "ready",
        payload: "one",
        idempotencyKey: "messageId-key",
      };

      const indexKey = makeMessageIdempotencyKey(store.namespace, run.id, "messageId-key");

      await store.appendEvent(run.id, messageId);
      await store.storage.delete(indexKey);
      await expect(store.storage.get(indexKey)).resolves.toBeUndefined();

      await expect(store.repairMessageIdempotencyIndexes(run.id)).resolves.toEqual([
        {
          runId: run.id,
          messageId: "ready",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        },
      ]);
      await expect(store.storage.get(indexKey)).resolves.toMatchObject({
        runId: run.id,
        messageId: "ready",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
      });
    });

    test("repairs message idempotency indexes to the latest durable event for each key", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-messageId-repair-latest"));

      const first: EventRecord = {
        kind: "message_sent",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        messageId: "ready-old",
        payload: "one",
        idempotencyKey: "messageId-key",
      };

      const latest: EventRecord = {
        kind: "message_sent",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        messageId: "ready-new",
        payload: "two",
        idempotencyKey: "messageId-key",
      };

      const indexKey = makeMessageIdempotencyKey(store.namespace, run.id, "messageId-key");
      await store.storage.set(
        makeEventsKey(store.namespace, run.id),
        toStorageValue([first, latest]),
      );

      await expect(store.repairMessageIdempotencyIndexes(run.id)).resolves.toEqual([
        {
          runId: run.id,
          messageId: "ready-new",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        },
      ]);
      await expect(store.storage.get(indexKey)).resolves.toMatchObject({
        runId: run.id,
        messageId: "ready-new",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
      });
    });
  });
}

for (const factory of storeFactories) {
  describeMessageIdempotencyContract({
    name: `workflow message idempotency contract: ${factory.name}`,
    createStore: factory.create,
  });
}
