import {
  InMemoryStorageEngine,
  createStorage,
  type StorageCompareAndSetManyItem,
  type StorageEngine,
  type StorageSetOptions,
  type StorageValue,
} from "@temelj/storage";

import type { RunId } from "../../src/types/run.ts";

import { makeEventsKey, makeRunKey } from "../../src/store-keys.ts";
import { parseStoredWorkflowRunRecord } from "../../src/store/validation.ts";
import { isMessageSentEventList } from "./events.ts";
import {
  eventHistoryStorageValue,
  readWorkflowEventHistoryStorageValue,
  readWorkflowRunRecordStorageValue,
  runRecordStorageValue,
} from "./storage-values.ts";

type WorkflowTestStorageCompareAndSet = (
  key: string,
  expected: StorageValue | undefined,
  value: StorageValue | undefined,
  options?: StorageSetOptions,
) => Promise<boolean>;
type WorkflowTestStorageCompareAndSetMany = (
  items: readonly StorageCompareAndSetManyItem<StorageValue>[],
) => Promise<boolean>;
type WorkflowTestStorageGet = (key: string) => Promise<StorageValue | undefined>;

export function createDelayedMessageAppendStorage(runId: RunId) {
  const storage = createStorage();
  const compareAndSet: WorkflowTestStorageCompareAndSet = storage.compareAndSet.bind(storage);
  const pending: Array<() => void> = [];

  storage.compareAndSet = async (
    key: string,
    expected: StorageValue | undefined,
    value: StorageValue | undefined,
    options?: StorageSetOptions,
  ) => {
    if (key === makeEventsKey("default", runId) && isMessageSentEventList(value)) {
      await new Promise<void>((resolve) => {
        pending.push(resolve);
        if (pending.length === 2) {
          for (const release of pending.splice(0)) {
            release();
          }
        }
      });
    }

    return await compareAndSet(key, expected, value, options);
  };

  return storage;
}

export function createMessageWaitAppendRaceStorage(runId: RunId) {
  const storage = createStorage();
  const compareAndSetMany: WorkflowTestStorageCompareAndSetMany =
    storage.compareAndSetMany.bind(storage);
  let raced = false;

  storage.compareAndSetMany = async (items) => {
    const workflowEventsStorageKey = makeEventsKey("default", runId);
    const appendsMessage = items.some(
      (item) => item.key === workflowEventsStorageKey && isMessageSentEventList(item.value),
    );
    if (!raced && appendsMessage) {
      raced = true;
      const currentEvents = await readWorkflowEventHistoryStorageValue(
        storage.get.bind(storage),
        workflowEventsStorageKey,
      );
      await storage.set(
        workflowEventsStorageKey,
        eventHistoryStorageValue([
          ...currentEvents,
          {
            kind: "message_wait_started",
            timestamp: "2026-06-07T10:00:01.000Z",
            stepId: "message-wait:second",
            stepName: "second",
            count: 1,
            messageId: "message",
            timeoutAt: "2026-06-07T11:00:00.000Z",
          },
        ]),
      );
    }
    return await compareAndSetMany(items);
  };

  return storage;
}

export function createSingleKeyMessageWaitAppendRaceStorage(runId: RunId) {
  const engine: StorageEngine = new InMemoryStorageEngine();
  disableStorageEngineMethod(engine, "compareAndSetMany");
  const storage = createStorage({ engine });
  const compareAndSet: WorkflowTestStorageCompareAndSet = storage.compareAndSet.bind(storage);
  let raced = false;

  storage.compareAndSet = async (
    key: string,
    expected: StorageValue | undefined,
    value: StorageValue | undefined,
    options?: StorageSetOptions,
  ) => {
    const workflowEventsStorageKey = makeEventsKey("default", runId);
    if (!raced && key === workflowEventsStorageKey && isMessageSentEventList(value)) {
      raced = true;
      const currentEvents = await readWorkflowEventHistoryStorageValue(
        storage.get.bind(storage),
        workflowEventsStorageKey,
      );
      await storage.set(
        workflowEventsStorageKey,
        eventHistoryStorageValue([
          ...currentEvents,
          {
            kind: "message_wait_started",
            timestamp: "2026-06-07T10:00:01.000Z",
            stepId: "message-wait:second",
            stepName: "second",
            count: 1,
            messageId: "message",
            timeoutAt: "2026-06-07T11:00:00.000Z",
          },
        ]),
        options,
      );
    }
    return await compareAndSet(key, expected, value, options);
  };

  return storage;
}

export function createTerminalDuplicateMessageCheckStorage(runId: RunId, idempotencyKey: string) {
  const engine: StorageEngine = new InMemoryStorageEngine();
  disableStorageEngineMethod(engine, "compareAndSetMany");
  const storage = createStorage({ engine });
  const get: WorkflowTestStorageGet = storage.get.bind(storage);
  let raced = false;

  storage.get = async (key: string) => {
    const value = await get(key);
    if (raced || key !== makeEventsKey("default", runId) || !hasMessageIdempotency(value)) {
      return value;
    }
    raced = true;
    const run = await readWorkflowRunRecordStorageValue(get, makeRunKey("default", runId));
    if (run !== undefined) {
      await storage.set(
        makeRunKey("default", runId),
        runRecordStorageValue({
          ...run,
          status: "completed",
          output: "external-terminal",
          updatedAt: "2026-06-07T10:30:00.000Z",
          lastTransitionAt: "2026-06-07T10:30:00.000Z",
          lastTransitionReason: "completed",
          finishedAt: "2026-06-07T10:30:00.000Z",
          workerId: undefined,
          leaseExpiresAt: undefined,
        }),
      );
    }
    return value;
  };

  function hasMessageIdempotency(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "kind" in event &&
          event.kind === "message_sent" &&
          "idempotencyKey" in event &&
          event.idempotencyKey === idempotencyKey,
      )
    );
  }

  return storage;
}

export function createDelayedCompareAndSetStorage(options: {
  readonly skipCalls?: number;
  readonly waitForCalls: number;
}) {
  const engine = new InMemoryStorageEngine();
  const compareAndSet = engine.compareAndSet?.bind(engine);
  if (compareAndSet === undefined) {
    throw new Error("Expected in-memory storage engine to support compareAndSet");
  }
  const pending: Array<() => void> = [];
  let calls = 0;

  engine.compareAndSet = async (key, expected, value, itemOptions) => {
    calls++;
    const delayed =
      calls > (options.skipCalls ?? 0) && calls <= (options.skipCalls ?? 0) + options.waitForCalls;
    if (delayed) {
      await new Promise<void>((resolve) => {
        pending.push(resolve);
        if (pending.length === options.waitForCalls) {
          for (const release of pending.splice(0)) {
            release();
          }
        }
      });
    }

    return await compareAndSet(key, expected, value, itemOptions);
  };

  return createStorage({ engine });
}

export function createTerminalMessageAppendRaceStorage(runId: RunId) {
  const storage = createStorage();
  const compareAndSetMany: WorkflowTestStorageCompareAndSetMany =
    storage.compareAndSetMany.bind(storage);
  let raced = false;

  storage.compareAndSetMany = async (items) => {
    const runStorageKey = makeRunKey("default", runId);
    const appendsMessage = items.some(
      (item) => item.key === makeEventsKey("default", runId) && isMessageSentEventList(item.value),
    );
    if (!raced && appendsMessage) {
      raced = true;
      const runItem = items.find((item) => item.key === runStorageKey);
      const run = parseStoredWorkflowRunRecord(runItem?.expected);
      if (run !== undefined) {
        await storage.set(
          runStorageKey,
          runRecordStorageValue({
            ...run,
            status: "canceled",
            updatedAt: "2026-06-07T10:00:00.000Z",
            lastTransitionAt: "2026-06-07T10:00:00.000Z",
            lastTransitionReason: "canceled",
            finishedAt: "2026-06-07T10:00:00.000Z",
            workerId: undefined,
            leaseExpiresAt: undefined,
          }),
        );
      }
    }
    return await compareAndSetMany(items);
  };

  return storage;
}

export function disableStorageEngineMethod<
  TMethod extends "compareAndSet" | "compareAndSetMany" | "watch",
>(engine: StorageEngine, method: TMethod): void {
  Object.defineProperty(engine, method, {
    configurable: true,
    value: undefined,
  });
}
