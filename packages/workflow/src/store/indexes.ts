import type { StorageValue } from "@temelj/storage";

import { deepEquals, isString } from "@temelj/value";

import type { EventRecord, MessageSentEvent } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { RunRecord } from "../types/run.ts";
import type {
  MessageIdempotencyIndex,
  WorkflowStorage,
  IdempotencyKeyOptions,
} from "../types/store.ts";
import type { EventAppendSuccessOutcome } from "./events.ts";

import { WorkflowMessageIdempotencyConflictError, WorkflowStateError } from "../errors/mod.ts";
import { History } from "../history/replay.ts";
import {
  makeEventsKey,
  makeMessageIdempotencyKey,
  makeIdempotencyKey,
  makeRunKey,
} from "../store-keys.ts";
import { supportsConditionalWrite, supportsAtomicBatchWrite } from "./capabilities.ts";
import { getStoredEventHistory, rollbackAppendedEventIfCurrent } from "./events.ts";
import { requireReadableStoredRun } from "./run.ts";
import { toStorageValue } from "./storage-value.ts";
import { isSameMessageIdempotencyIndex, isReadableRunRecord } from "./validation.ts";

interface DuplicateMessageAppendOutcome {
  readonly status: "duplicate";
  readonly events: readonly EventRecord[];
}

export function duplicateMessageAppendOutcome(
  runId: RunId,
  events: readonly EventRecord[],
  event: EventRecord,
): DuplicateMessageAppendOutcome | undefined {
  if (!isMessageIdempotencyEvent(event)) {
    return undefined;
  }

  const existing = new History(events).messageByIdempotencyKey(event.idempotencyKey);

  if (existing === undefined) {
    return undefined;
  }

  requireDuplicateMessageEventMatches(runId, existing, event);

  return { status: "duplicate", events };
}

function isMessageIdempotencyEvent(
  event: EventRecord,
): event is MessageSentEvent & { readonly idempotencyKey: string } {
  return event.kind === "message_sent" && event.idempotencyKey !== undefined;
}

function requireDuplicateMessageEventMatches(
  runId: RunId,
  existing: MessageSentEvent,
  event: MessageSentEvent & { readonly idempotencyKey: string },
): void {
  if (existing.messageId === event.messageId && deepEquals(existing.payload, event.payload)) {
    return;
  }

  // Message idempotency keys protect the target run from receiving two distinct logical messages under the same caller-supplied key.
  WorkflowMessageIdempotencyConflictError.conflict({
    runId,
    messageId: existing.messageId,
    idempotencyKey: event.idempotencyKey,
  });
}

async function indexMessageIdempotencyKey(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  events: readonly EventRecord[],
): Promise<void> {
  if (event.kind !== "message_sent" || event.idempotencyKey === undefined) {
    return;
  }

  await requireReadableStoredRun(storage, namespace, runId);

  const indexedEvent = indexableMessageEventByIdempotencyKey(
    new History(events),
    event.idempotencyKey,
  );

  if (indexedEvent === undefined) {
    return;
  }

  // The index is a derived fast path for duplicate message sends.
  // The event history remains the source of truth, so indexing the same event twice is harmless but conflicting values are not.
  const key = makeMessageIdempotencyKey(namespace, runId, event.idempotencyKey);

  const value = {
    runId,
    messageId: indexedEvent.messageId,
    timestamp: indexedEvent.timestamp,
  };

  if (!supportsConditionalWrite(storage)) {
    const current = await storage.get(key);

    if (current !== undefined) {
      if (isSameMessageIdempotencyIndex(current, value)) {
        return;
      }

      WorkflowMessageIdempotencyConflictError.conflict({
        runId,
        messageId: indexedEvent.messageId,
        idempotencyKey: event.idempotencyKey,
      });
    }

    await storage.set(key, toStorageValue(value));

    return;
  }

  const indexed = await storage.compareAndSet(key, undefined, toStorageValue(value));

  if (indexed) {
    return;
  }

  const current = await storage.get(key);

  if (isSameMessageIdempotencyIndex(current, value)) {
    return;
  }

  WorkflowMessageIdempotencyConflictError.conflict({
    runId,
    messageId: indexedEvent.messageId,
    idempotencyKey: event.idempotencyKey,
  });
}

export async function projectMessageIdempotencyIndexForAppendOutcome(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  outcome: EventAppendSuccessOutcome,
): Promise<readonly EventRecord[]> {
  try {
    await indexMessageIdempotencyKey(storage, namespace, runId, event, outcome.events);
  } catch (error) {
    if (outcome.status === "appended") {
      await rollbackAppendedEventIfCurrent(
        storage,
        namespace,
        runId,
        outcome.events,
        outcome.previousEventHistory,
      );
    }

    throw error;
  }

  return outcome.events;
}

async function reconcileMessageIdempotencyIndexes(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  events: readonly EventRecord[],
): Promise<readonly MessageIdempotencyIndex[]> {
  await requireReadableStoredRun(storage, namespace, runId);

  const indexes = messageIdempotencyIndexValuesFromEvents(events, runId);
  await Promise.all(
    indexes.map(async ({ idempotencyKey, value }) => {
      await storeMessageIdempotencyIndex(storage, namespace, runId, idempotencyKey, value);
    }),
  );

  return indexes.map((index) => index.value);
}

export async function repairMessageIdempotencyIndexes(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<readonly MessageIdempotencyIndex[]> {
  await requireReadableStoredRun(storage, namespace, runId);

  return await reconcileMessageIdempotencyIndexes(
    storage,
    namespace,
    runId,
    (await getStoredEventHistory(storage, makeEventsKey(namespace, runId))).events,
  );
}

export async function hasMessageIdempotencyKey(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  idempotencyKey: string,
): Promise<boolean> {
  return (
    (await storage.get(makeMessageIdempotencyKey(namespace, runId, idempotencyKey))) !== undefined
  );
}

function indexableMessageEventByIdempotencyKey(
  history: History,
  idempotencyKey: string,
): MessageSentEvent | undefined {
  const event = history.messageByIdempotencyKey(idempotencyKey);

  return event !== undefined && isIndexableMessageIdempotencyEvent(event) ? event : undefined;
}

export function messageIdempotencyIndexValuesFromEvents(
  events: readonly EventRecord[],
  runId: RunId,
): readonly {
  readonly idempotencyKey: string;
  readonly value: MessageIdempotencyIndex;
}[] {
  return new History(events)
    .latestMessagesByIdempotencyKey()
    .filter(isIndexableMessageIdempotencyEvent)
    .map((event) => ({
      idempotencyKey: event.idempotencyKey,
      value: {
        runId,
        messageId: event.messageId,
        timestamp: event.timestamp,
      },
    }));
}

function isIndexableMessageIdempotencyEvent(event: EventRecord): event is MessageSentEvent & {
  readonly idempotencyKey: string;
  readonly messageId: string;
} {
  return (
    event.kind === "message_sent" &&
    event.idempotencyKey !== undefined &&
    event.messageId.trim() !== ""
  );
}

async function storeMessageIdempotencyIndex(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  idempotencyKey: string,
  value: MessageIdempotencyIndex,
): Promise<void> {
  const key = makeMessageIdempotencyKey(namespace, runId, idempotencyKey);
  const current = await storage.get(key);

  if (isSameMessageIdempotencyIndex(current, value)) {
    return;
  }

  if (!supportsConditionalWrite(storage)) {
    await storage.set(key, toStorageValue(value));

    return;
  }

  const stored = await storage.compareAndSet(key, current, toStorageValue(value));

  if (!stored) {
    WorkflowMessageIdempotencyConflictError.conflict({
      runId,
      messageId: value.messageId,
      idempotencyKey,
    });
  }
}

const MAX_IDEMPOTENT_CREATE_WAIT_ATTEMPTS = 16;

interface IdempotencyRunReader {
  getRun(runId: string): Promise<RunRecord | undefined>;
}

type IdempotencyClaim =
  | {
      readonly status: "claimed";
      readonly key: string;
      readonly value: StorageValue;
    }
  | {
      readonly status: "existing";
      readonly run: RunRecord;
    };

interface RunCreationClaim {
  readonly eventsKey?: string;
  readonly runKey?: string;
}

export async function createRunWithIdempotency(
  storage: WorkflowStorage,
  namespace: string,
  store: IdempotencyRunReader,
  run: RunRecord,
): Promise<RunRecord> {
  if (run.namespace !== namespace) {
    throw WorkflowStateError.runNamespaceMismatch(String(run.namespace), namespace);
  }

  const keyOptions = idempotencyKeyOptionsForRun(run);

  if (supportsAtomicBatchWrite(storage)) {
    return await createRunAtomicallyWithIdempotency(storage, namespace, store, run, keyOptions);
  }

  const idempotencyClaim =
    keyOptions === undefined
      ? undefined
      : await claimIdempotencyIndex(storage, namespace, store, run, keyOptions);

  if (idempotencyClaim?.status === "existing") {
    return idempotencyClaim.run;
  }

  if (keyOptions !== undefined) {
    assertIdempotencyClaimed(run.id, idempotencyClaim);
  }

  try {
    await createRunRecordAndEventHistory(storage, namespace, run);

    return run;
  } catch (error) {
    await rollbackIdempotencyClaim(storage, idempotencyClaim);
    throw error;
  }
}

async function createRunRecordAndEventHistory(
  storage: WorkflowStorage,
  namespace: string,
  run: RunRecord,
): Promise<RunCreationClaim> {
  const runKey = makeRunKey(namespace, run.id);
  const eventsKey = makeEventsKey(namespace, run.id);
  let claim: RunCreationClaim = {};

  try {
    if (!supportsConditionalWrite(storage)) {
      if ((await storage.get(runKey)) !== undefined) {
        WorkflowStateError.runIdAlreadyExists(run.id);
      }

      if ((await storage.get(eventsKey)) !== undefined) {
        WorkflowStateError.eventHistoryAlreadyExists(run.id);
      }

      await storage.set(runKey, toStorageValue(run));
      claim = { runKey };
      await storage.set(eventsKey, toStorageValue([]));

      return { ...claim, eventsKey };
    }

    const claimedRun = await storage.compareAndSet(runKey, undefined, toStorageValue(run));

    if (!claimedRun) {
      WorkflowStateError.runIdAlreadyExists(run.id);
    }

    claim = { runKey };
    const claimedEvents = await storage.compareAndSet(eventsKey, undefined, toStorageValue([]));

    if (!claimedEvents) {
      WorkflowStateError.eventHistoryAlreadyExists(run.id);
    }

    return { ...claim, eventsKey };
  } catch (error) {
    await rollbackRunCreationClaim(storage, claim);
    throw error;
  }
}

async function rollbackRunCreationClaim(
  storage: WorkflowStorage,
  claim: RunCreationClaim,
): Promise<void> {
  await storage.deleteMany([
    ...(claim.runKey === undefined ? [] : [claim.runKey]),
    ...(claim.eventsKey === undefined ? [] : [claim.eventsKey]),
  ]);
}

async function rollbackIdempotencyClaim(
  storage: WorkflowStorage,
  claim: IdempotencyClaim | undefined,
): Promise<void> {
  if (claim?.status !== "claimed") {
    return;
  }

  if (!supportsConditionalWrite(storage)) {
    await storage.delete(claim.key);

    return;
  }

  await storage.compareAndSet(claim.key, claim.value, undefined);
}

async function claimIdempotencyIndex(
  storage: WorkflowStorage,
  namespace: string,
  store: IdempotencyRunReader,
  run: RunRecord,
  keyOptions: IdempotencyKeyOptions,
): Promise<IdempotencyClaim> {
  const key = makeIdempotencyKey(namespace, keyOptions);
  const value = toStorageValue(run.id);

  if (!supportsConditionalWrite(storage)) {
    const existingRun = await getRunByIdempotencyKey(storage, namespace, store, keyOptions);

    if (existingRun !== undefined) {
      return { status: "existing", run: existingRun };
    }

    await storage.set(key, value);

    return { status: "claimed", key, value };
  }

  const claimed = await storage.compareAndSet(key, undefined, value);

  if (claimed) {
    return { status: "claimed", key, value };
  }

  const existingRun = await waitForRunByIdempotencyKey(storage, namespace, store, keyOptions);

  if (existingRun !== undefined) {
    return { status: "existing", run: existingRun };
  }

  if (!(await releaseStaleIdempotencyIndex(storage, namespace, store, keyOptions))) {
    WorkflowStateError.idempotencyKeyClaimedWithoutRun(run.id);
  }

  const reclaimed = await storage.compareAndSet(key, undefined, value);

  if (reclaimed) {
    return { status: "claimed", key, value };
  }

  const reclaimedExistingRun = await waitForRunByIdempotencyKey(
    storage,
    namespace,
    store,
    keyOptions,
  );

  if (reclaimedExistingRun !== undefined) {
    return { status: "existing", run: reclaimedExistingRun };
  }

  WorkflowStateError.idempotencyKeyClaimedWithoutRun(run.id);
}

function assertIdempotencyClaimed(
  runId: string,
  claim: IdempotencyClaim | undefined,
): asserts claim is Extract<IdempotencyClaim, { readonly status: "claimed" }> {
  if (claim?.status !== "claimed") {
    WorkflowStateError.idempotencyKeyClaimedWithoutRun(runId);
  }
}

async function createRunAtomicallyWithIdempotency(
  storage: WorkflowStorage,
  namespace: string,
  store: IdempotencyRunReader,
  run: RunRecord,
  keyOptions: IdempotencyKeyOptions | undefined,
): Promise<RunRecord> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const created = await storage.compareAndSetMany([
      ...atomicIdempotencyClaimItems(namespace, run, keyOptions),
      { key: makeRunKey(namespace, run.id), expected: undefined, value: toStorageValue(run) },
      { key: makeEventsKey(namespace, run.id), expected: undefined, value: toStorageValue([]) },
    ]);

    if (created) {
      return run;
    }

    if (keyOptions === undefined) {
      WorkflowStateError.runIdAlreadyExists(run.id);
    }

    const existingRun = await waitForRunByIdempotencyKey(storage, namespace, store, keyOptions);

    if (existingRun !== undefined) {
      return existingRun;
    }

    if (
      attempt === 0 &&
      (await releaseStaleIdempotencyIndex(storage, namespace, store, keyOptions))
    ) {
      continue;
    }

    WorkflowStateError.idempotencyKeyClaimedWithoutRun(run.id);
  }

  throw WorkflowStateError.runIdAlreadyExists(run.id);
}

function atomicIdempotencyClaimItems(
  namespace: string,
  run: RunRecord,
  keyOptions: IdempotencyKeyOptions | undefined,
): readonly {
  readonly key: string;
  readonly expected: undefined;
  readonly value: StorageValue;
}[] {
  return keyOptions === undefined
    ? []
    : [
        {
          key: makeIdempotencyKey(namespace, keyOptions),
          expected: undefined,
          value: toStorageValue(run.id),
        },
      ];
}

export async function getRunByIdempotencyKey(
  storage: WorkflowStorage,
  namespace: string,
  store: IdempotencyRunReader,
  options: IdempotencyKeyOptions,
): Promise<RunRecord | undefined> {
  const runId = await storage.get(makeIdempotencyKey(namespace, options));

  if (!(isString(runId) && runId.trim() !== "")) {
    return undefined;
  }

  const run = await store.getRun(runId);

  return run !== undefined &&
    isReadableRunRecord(run, run.namespace) &&
    run.workflowName === options.workflowName &&
    run.workflowVersion === options.workflowVersion &&
    run.idempotencyKey === options.idempotencyKey
    ? run
    : undefined;
}

function idempotencyKeyOptionsForRun(run: RunRecord): IdempotencyKeyOptions | undefined {
  if (run.idempotencyKey === undefined) return undefined;

  return {
    workflowName: run.workflowName,
    workflowVersion: run.workflowVersion,
    idempotencyKey: run.idempotencyKey,
  };
}

async function waitForRunByIdempotencyKey(
  storage: WorkflowStorage,
  namespace: string,
  store: IdempotencyRunReader,
  options: IdempotencyKeyOptions,
): Promise<RunRecord | undefined> {
  for (let attempt = 0; attempt < MAX_IDEMPOTENT_CREATE_WAIT_ATTEMPTS; attempt++) {
    const run = await getRunByIdempotencyKey(storage, namespace, store, options);

    if (run !== undefined) {
      return run;
    }

    await Promise.resolve();
  }

  return undefined;
}

async function releaseStaleIdempotencyIndex(
  storage: WorkflowStorage,
  namespace: string,
  store: IdempotencyRunReader,
  options: IdempotencyKeyOptions,
): Promise<boolean> {
  if (!supportsConditionalWrite(storage)) {
    return false;
  }

  const key = makeIdempotencyKey(namespace, options);
  const value = await storage.get(key);

  if (value === undefined) {
    return false;
  }

  if (isString(value) && value.trim() !== "") {
    const run = await store.getRun(value);

    if (
      run !== undefined &&
      isReadableRunRecord(run, run.namespace) &&
      run.workflowName === options.workflowName &&
      run.workflowVersion === options.workflowVersion &&
      run.idempotencyKey === options.idempotencyKey
    ) {
      return false;
    }
  }

  return await storage.compareAndSet(key, value, undefined);
}
