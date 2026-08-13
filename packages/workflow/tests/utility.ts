import {
  InMemoryStorageEngine,
  createStorage,
  type StorageEngine,
  type StorageKeyOptions,
  type StorageSetOptions,
  type StorageValue,
} from "@temelj/storage";

import type { WorkflowEngine } from "../src/types/engine.ts";
import type { EventRecord } from "../src/types/events.ts";
import type { RunId } from "../src/types/run.ts";
import type { WorkflowStorage } from "../src/types/store.ts";

import { makeEventsKey, makeRunKey } from "../src/store-keys.ts";
import { disableStorageEngineMethod } from "./support/storage-races.ts";
import {
  eventHistoryStorageValue,
  readWorkflowEventHistoryStorageValue,
  runRecordStorageValue,
} from "./support/storage-values.ts";

export { isMessageSentEventList } from "./support/events.ts";
export {
  importSpecifiers,
  isConcreteBackendSpecifier,
  isStorageBackendSpecifier,
  readWorkflowPackageJson,
  storageBackendImports,
  storageBackendPackageDependencies,
  workflowRuntimeSourceFiles,
} from "./support/metadata.ts";
export {
  createDelayedCompareAndSetStorage,
  createDelayedMessageAppendStorage,
  createMessageWaitAppendRaceStorage,
  createSingleKeyMessageWaitAppendRaceStorage,
  createTerminalDuplicateMessageCheckStorage,
  createTerminalMessageAppendRaceStorage,
  disableStorageEngineMethod,
} from "./support/storage-races.ts";
export {
  delay,
  readStream,
  requireNoDuplicateWorkflowEventsAfterReplay,
  resumeHook,
  resumeWebhook,
  waitFor,
  waitForHook,
  waitForWorkflowSleep,
  wakeWorkflowRun,
} from "./support/waiters.ts";
export { createMockWebStorage } from "./support/web-storage.ts";

type WorkflowTestStorageCompareAndSet = (
  key: string,
  expected: StorageValue | undefined,
  value: StorageValue | undefined,
  options?: StorageSetOptions,
) => Promise<boolean>;
type WorkflowTestStorageGet = (key: string) => Promise<StorageValue | undefined>;

export async function eventTypes(
  engine: WorkflowEngine,
  runId: RunId,
): Promise<readonly EventRecord["kind"][]> {
  return (await engine.getEvents(runId)).map((event) => event.kind);
}

export function sequentialRunIds(...ids: readonly string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `run_${index}`;
}

export function createHiddenFirstRunScanStorage() {
  const storage = createStorage();
  const entries = storage.entries.bind(storage);
  const runPrefix = "workflow:default:run:";
  let hidden = false;

  storage.entries = async (options?: StorageKeyOptions) => {
    if (!hidden && options?.prefix === runPrefix) {
      hidden = true;
      return [];
    }
    return await entries(options);
  };

  return storage;
}

export function createBestEffortStorage() {
  const engine: StorageEngine<string> = new InMemoryStorageEngine<string>();
  disableStorageEngineMethod(engine, "compareAndSet");
  disableStorageEngineMethod(engine, "compareAndSetMany");
  return createStorage({ engine });
}

export function createSingleKeyConditionalStorage() {
  const engine: StorageEngine<string> = new InMemoryStorageEngine<string>();
  disableStorageEngineMethod(engine, "compareAndSetMany");
  return createStorage({ engine });
}

export function createPollutedCleanupStepAttemptKeyStorage(extraKey: string) {
  return createPollutedCleanupStepAttemptKeysStorage([extraKey]);
}

export function createPollutedCleanupStepAttemptKeysStorage(extraKeys: readonly string[]) {
  const storage = createStorage();
  const keys = storage.keys.bind(storage);
  storage.keys = async (options?: StorageKeyOptions) => {
    const found = await keys(options);
    if (options?.prefix?.startsWith("workflow:default:step-attempt:run_cleanup_") === true) {
      return [...found, ...extraKeys];
    }
    return found;
  };
  return storage;
}

export function corruptRunDuringNextEventHistoryRead(storage: WorkflowStorage, runId: RunId) {
  const get: WorkflowTestStorageGet = storage.get.bind(storage);
  let corrupted = false;
  storage.get = async (key: string) => {
    const value = await get(key);
    if (!corrupted && key === makeEventsKey("default", runId)) {
      corrupted = true;
      const run = await get(makeRunKey("default", runId));
      if (typeof run === "object" && run !== null) {
        const runRecord = run as Record<string, unknown>;
        await storage.set(
          makeRunKey("default", runId),
          runRecordStorageValue({
            ...runRecord,
            workflowName: " ",
          }),
        );
      }
    }
    return value;
  };
}

export function createRepointingMessageCleanupStorage(messageKey: string) {
  const storage = createStorage();
  const compareAndSet: WorkflowTestStorageCompareAndSet = storage.compareAndSet.bind(storage);
  let repointed = false;

  storage.compareAndSet = async (
    key: string,
    expected: StorageValue | undefined,
    value: StorageValue | undefined,
    options?: StorageSetOptions,
  ) => {
    if (!repointed && key === messageKey && value === undefined) {
      repointed = true;
      await storage.set(key, {
        runId: "run_elsewhere",
        messageId: "message",
        timestamp: "2026-06-07T10:01:00.000Z",
      });
    }
    return await compareAndSet(key, expected, value, options);
  };

  return storage;
}

export function createRepointingCleanupStorage(idempotencyKey: string) {
  const storage = createStorage();
  const compareAndSet: WorkflowTestStorageCompareAndSet = storage.compareAndSet.bind(storage);
  let repointed = false;

  storage.compareAndSet = async (
    key: string,
    expected: StorageValue | undefined,
    value: StorageValue | undefined,
    options?: StorageSetOptions,
  ) => {
    if (!repointed && key === idempotencyKey && value === undefined) {
      repointed = true;
      await storage.set(key, "run_elsewhere");
    }
    return await compareAndSet(key, expected, value, options);
  };

  return storage;
}

export function createRepointingRunCleanupStorage(runId: RunId) {
  const storage = createStorage();
  const compareAndSet: WorkflowTestStorageCompareAndSet = storage.compareAndSet.bind(storage);
  const runStorageKey = makeRunKey("default", runId);
  let repointed = false;

  storage.compareAndSet = async (
    key: string,
    expected: StorageValue | undefined,
    value: StorageValue | undefined,
    options?: StorageSetOptions,
  ) => {
    if (!repointed && key === runStorageKey && value === undefined) {
      repointed = true;
      await storage.set(key, {
        id: runId,
        namespace: "default",
        workflowName: "cleanup-run-changed-during-delete",
        status: "completed",
        output: "repointed",
        createdAt: "2026-06-07T10:00:00.000Z",
        updatedAt: "2026-06-07T10:01:00.000Z",
        startedAt: "2026-06-07T10:00:00.000Z",
        finishedAt: "2026-06-07T10:01:00.000Z",
        lastTransitionAt: "2026-06-07T10:01:00.000Z",
        lastTransitionReason: "external cleanup race",
      });
    }
    return await compareAndSet(key, expected, value, options);
  };

  return storage;
}

export function createFailingCreateRunStorage(runId: RunId) {
  const engine = new InMemoryStorageEngine<string>();
  const compareAndSetMany = engine.compareAndSetMany?.bind(engine);
  const set = engine.set.bind(engine);
  let failed = false;

  if (compareAndSetMany === undefined) {
    throw new Error("Expected in-memory storage engine to support conditional batches");
  }
  engine.compareAndSetMany = async (items) => {
    if (!failed && items.some((item) => item.key === makeEventsKey("default", runId))) {
      failed = true;
      throw new Error("workflow event history write failed");
    }
    return await compareAndSetMany(items);
  };

  engine.set = async (key, value, options) => {
    if (!failed && key === makeEventsKey("default", runId)) {
      failed = true;
      throw new Error("workflow event history write failed");
    }
    await set(key, value, options);
  };

  return createStorage({ engine });
}

export function createFailingFallbackCreateRunStorage(runId: RunId) {
  const engine = new InMemoryStorageEngine<string>();
  disableStorageEngineMethod(engine, "compareAndSet");
  disableStorageEngineMethod(engine, "compareAndSetMany");
  const set = engine.set.bind(engine);
  let failed = false;

  engine.set = async (key, value, options) => {
    if (!failed && key === makeEventsKey("default", runId)) {
      failed = true;
      throw new Error("workflow event history write failed");
    }
    await set(key, value, options);
  };

  return createStorage({ engine });
}

export function createFailingStepAttemptStorage() {
  const engine: StorageEngine<string> = new InMemoryStorageEngine<string>();
  const set = engine.set.bind(engine);
  disableStorageEngineMethod(engine, "compareAndSet");
  disableStorageEngineMethod(engine, "compareAndSetMany");
  engine.set = async (key, value, options) => {
    if (key.includes(":step-attempt:")) {
      throw new Error("step attempt write failed");
    }
    await set(key, value, options);
  };
  return createStorage({ engine });
}

export function createConcurrentEventAppendOnStepAttemptFailureStorage(runId: RunId) {
  const engine: StorageEngine<string> = new InMemoryStorageEngine<string>();
  let failed = false;
  disableStorageEngineMethod(engine, "compareAndSet");
  disableStorageEngineMethod(engine, "compareAndSetMany");
  const storage: WorkflowStorage = createStorage({ engine });
  const get = storage.get.bind(storage);
  const set = storage.set.bind(storage);
  storage.set = async (key: string, value: StorageValue, options?: StorageSetOptions) => {
    if (!failed && key.includes(":step-attempt:")) {
      failed = true;
      const workflowEventsStorageKey = makeEventsKey("default", runId);
      const events = await readWorkflowEventHistoryStorageValue(get, workflowEventsStorageKey);
      await set(
        workflowEventsStorageKey,
        eventHistoryStorageValue([
          ...events,
          {
            kind: "workflow_started",
            timestamp: Temporal.Instant.from("2026-06-07T10:00:01.000Z"),
          },
        ]),
        options,
      );
      throw new Error("step attempt write failed after concurrent event append");
    }
    await set(key, value, options);
  };
  return storage;
}

export function createFailingMessageIdempotencyStorage() {
  const engine = new InMemoryStorageEngine<string>();
  const set = engine.set.bind(engine);
  const compareAndSet = engine.compareAndSet?.bind(engine);
  engine.set = async (key, value, options) => {
    if (key.includes(":message-idempotency:")) {
      throw new Error("messageId idempotency write failed");
    }
    await set(key, value, options);
  };
  if (compareAndSet !== undefined) {
    engine.compareAndSet = async (key, expected, value, options) => {
      if (key.includes(":message-idempotency:")) {
        throw new Error("messageId idempotency write failed");
      }
      return await compareAndSet(key, expected, value, options);
    };
  }
  return createStorage({ engine });
}

export function createConcurrentMessageIdempotencyClaimStorage(messageKey: string) {
  const storage = createStorage();
  const compareAndSet: WorkflowTestStorageCompareAndSet = storage.compareAndSet.bind(storage);
  let claimed = false;

  storage.compareAndSet = async (
    key: string,
    expected: StorageValue | undefined,
    value: StorageValue | undefined,
    options?: StorageSetOptions,
  ) => {
    if (!claimed && key === messageKey && expected === undefined && value !== undefined) {
      claimed = true;
      await storage.set(
        key,
        {
          runId: "run_message_idempotency_concurrent_index_claim",
          messageId: "other",
          timestamp: "2026-06-07T10:00:00.000Z",
        },
        options,
      );
      return false;
    }
    return await compareAndSet(key, expected, value, options);
  };

  return storage;
}

export function createConcurrentMessageReplacementOnIdempotencyFailureStorage(runId: RunId) {
  const engine: StorageEngine<string> = new InMemoryStorageEngine<string>();
  disableStorageEngineMethod(engine, "compareAndSet");
  disableStorageEngineMethod(engine, "compareAndSetMany");
  const storage: WorkflowStorage = createStorage({ engine });
  const set = storage.set.bind(storage);
  let failed = false;
  storage.set = async (key: string, value: StorageValue, options?: StorageSetOptions) => {
    if (!failed && key.includes(":message-idempotency:")) {
      failed = true;
      await set(
        makeEventsKey("default", runId),
        eventHistoryStorageValue([
          {
            kind: "message_sent",
            timestamp: "2026-06-07T10:00:00.000Z",
            messageId: "message",
            payload: { message: "concurrent" },
            idempotencyKey: "messageId-concurrent",
          },
        ]),
        options,
      );
      throw new Error("messageId idempotency write failed after concurrent replacement");
    }
    await set(key, value, options);
  };
  return storage;
}

export function createConcurrentMalformedMessageWaitersOnIdempotencyFailureStorage(runId: RunId) {
  const engine: StorageEngine<string> = new InMemoryStorageEngine<string>();
  disableStorageEngineMethod(engine, "compareAndSet");
  disableStorageEngineMethod(engine, "compareAndSetMany");
  const storage: WorkflowStorage = createStorage({ engine });
  const set = storage.set.bind(storage);
  let failed = false;
  storage.set = async (key: string, value: StorageValue, options?: StorageSetOptions) => {
    if (!failed && key.includes(":message-idempotency:")) {
      failed = true;
      await set(
        makeEventsKey("default", runId),
        eventHistoryStorageValue([
          {
            kind: "message_sent",
            timestamp: "2026-06-07T10:00:00.000Z",
            messageId: "message",
            payload: { message: "original" },
            waiterStepIds: "ab",
            idempotencyKey: "messageId-original",
          },
        ]),
        options,
      );
      throw new Error("messageId idempotency write failed after malformed waiter replacement");
    }
    await set(key, value, options);
  };
  return storage;
}
