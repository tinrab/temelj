import type { StorageValue } from "@temelj/storage";

import { deepEquals } from "@temelj/value";

import type {
  CleanupMarkerRecord,
  CleanupRunsOptions,
  CleanupRunsResult,
  CleanupRunResult,
  CleanupStatusFilter,
} from "../types/cleanup.ts";
import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { ListRunsOptions } from "../types/run-list.ts";
import type { RunRecord, TerminalRunStatus } from "../types/run.ts";
import type {
  CleanupIndexKey,
  MessageIdempotencyIndex,
  WorkflowStorage,
  IdempotencyKeyOptions,
} from "../types/store.ts";

import { omitUndefined, uniqueBy } from "../collection.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowStateError } from "../errors/mod.ts";
import { isTerminalRunStatus } from "../run-status.ts";
import {
  makeCleanupMarkerKey,
  makeCleanupMarkerKeyPrefix,
  makeEventsKey,
  makeIdempotencyKey,
  makeRunKey,
  makeMessageIdempotencyKey,
  makeStepAttemptKeyPrefix,
  MessageIdempotencyKey,
  IdempotencyKey,
  EventsKey,
  isStepAttemptKey,
} from "../store-keys.ts";
import { compareOptionalTimestamps } from "../temporal.ts";
import { supportsConditionalWrite } from "./capabilities.ts";
import { getStoredCleanupEventHistory } from "./events.ts";
import { messageIdempotencyIndexValuesFromEvents } from "./indexes.ts";
import { getReadableStoredRun } from "./run.ts";
import { toStorageValue } from "./storage-value.ts";
import {
  isReadableMessageIdempotencyIndex,
  isSameMessageIdempotencyIndex,
  readableCleanupMarkerRecord,
} from "./validation.ts";

interface MessageIdempotencyEventIndex {
  readonly key: MessageIdempotencyKey;
  readonly value: MessageIdempotencyIndex;
}

interface CleanupRunKey {
  readonly key: string;
  readonly run: RunRecord;
}

interface CleanupRunLister {
  listRuns(options: ListRunsOptions): Promise<readonly RunRecord[]>;
}

async function stepAttemptKeysForCleanup(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<readonly string[]> {
  const prefix = makeStepAttemptKeyPrefix(namespace, runId);

  return [
    ...new Set(
      (await storage.keys({ prefix })).filter((key) => isStepAttemptKey(key, namespace, runId)),
    ),
  ];
}

async function messageIdempotencyIndexesForCleanup(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  events: readonly EventRecord[],
): Promise<readonly CleanupIndexKey[]> {
  const candidatesByKey = new Map<string, readonly MessageIdempotencyEventIndex[]>();

  for (const candidate of messageIdempotencyIndexesFromEvents(namespace, runId, events)) {
    candidatesByKey.set(candidate.key, [...(candidatesByKey.get(candidate.key) ?? []), candidate]);
  }

  const entries = await Promise.all(
    [...candidatesByKey.keys()].map(async (key) => ({
      key,
      value: await storage.get(key),
    })),
  );

  return entries
    .filter((entry): entry is typeof entry & { readonly value: MessageIdempotencyIndex } =>
      isCurrentMessageIdempotencyIndex(candidatesByKey.get(entry.key) ?? [], entry.value),
    )
    .map(toCleanupIndex);
}

async function idempotencyIndexesForCleanup(
  storage: WorkflowStorage,
  namespace: string,
  run: RunRecord,
): Promise<readonly CleanupIndexKey[]> {
  if (run.idempotencyKey === undefined) {
    return [];
  }

  const key = idempotencyKeyFromRun(namespace, run);
  const value = await storage.get(key);

  return value === run.id ? [{ key, value }] : [];
}

export async function deleteCleanupIndexes(
  storage: WorkflowStorage,
  indexes: readonly CleanupIndexKey[],
): Promise<number> {
  const uniqueIndexes = uniqueBy(indexes, (index) => index.key);

  if (!supportsConditionalWrite(storage)) {
    const currentIndexes = await Promise.all(
      uniqueIndexes.map(async (index) => ({
        ...index,
        current: await storage.get(index.key),
      })),
    );

    return await storage.deleteMany(
      currentIndexes.flatMap((index) =>
        workflowCleanupIndexMatchesCurrentValue(index.current, index.value) ? [index.key] : [],
      ),
    );
  }

  const deleted = await Promise.all(
    uniqueIndexes.map((index) => storage.compareAndSet(index.key, index.value, undefined)),
  );

  return deleted.filter((value) => value).length;
}

function workflowCleanupIndexMatchesCurrentValue(
  current: StorageValue | undefined,
  expected: StorageValue,
): boolean {
  if (isReadableMessageIdempotencyIndex(expected)) {
    return isSameMessageIdempotencyIndex(current, expected);
  }

  return deepEquals(current, expected);
}

function messageIdempotencyIndexesFromEvents(
  namespace: string,
  runId: RunId,
  events: readonly EventRecord[],
): readonly MessageIdempotencyEventIndex[] {
  return messageIdempotencyIndexValuesFromEvents(events, runId).map(
    ({ idempotencyKey, value }) => ({
      key: makeMessageIdempotencyKey(namespace, runId, idempotencyKey),
      value,
    }),
  );
}

function idempotencyKeyFromRun(namespace: string, run: RunRecord): IdempotencyKey {
  if (run.idempotencyKey === undefined) {
    throw new WorkflowStateError(`Workflow run does not have an idempotency key: ${run.id}`, {
      code: WorkflowErrorCode.STATE_RUN_MISSING_IDEMPOTENCY_KEY,
      details: { runId: run.id },
    });
  }

  const options: IdempotencyKeyOptions = {
    workflowName: run.workflowName,
    workflowVersion: run.workflowVersion,
    idempotencyKey: run.idempotencyKey,
  };

  return makeIdempotencyKey(namespace, options);
}

function toCleanupIndex(entry: {
  readonly key: string;
  readonly value: MessageIdempotencyIndex;
}): CleanupIndexKey {
  return {
    key: entry.key,
    value: toStorageValue(entry.value),
  };
}

function isCurrentMessageIdempotencyIndex(
  eventIndexes: readonly MessageIdempotencyEventIndex[],
  value: unknown,
): value is MessageIdempotencyIndex {
  if (!isReadableMessageIdempotencyIndex(value)) {
    return false;
  }

  return eventIndexes.some((eventIndex) => isSameMessageIdempotencyIndex(value, eventIndex.value));
}

export async function cleanupRuns(
  storage: WorkflowStorage,
  namespace: string,
  runs: CleanupRunLister,
  options: CleanupRunsOptions,
): Promise<CleanupRunsResult> {
  const limit = options.limit;
  const statusFilter = options.status ?? ["completed", "failed", "canceled"];

  const selectedRuns = uniqueBy(
    (
      await runs.listRuns({
        status: Array.isArray(statusFilter) ? [...statusFilter] : statusFilter,
        workflowName: options.workflowName,
        workflowVersion: options.workflowVersion,
        idempotencyKey: options.idempotencyKey,
        parentRunId: options.parentRunId,
        parentStepId: options.parentStepId,
        parentStepName: options.parentStepName,
        parentStepAttempt: options.parentStepAttempt,
      })
    )
      .filter((run) => isRunEligibleForCleanup(run, options))
      .sort(compareCleanupRuns),
    (run) => run.id,
  ).slice(0, limit);

  const stepAttemptKeysByRun = await Promise.all(
    selectedRuns.map((run) => stepAttemptKeysForCleanup(storage, namespace, run.id)),
  );

  const stepAttemptKeys = stepAttemptKeysByRun.flat();
  const eventKeysByRun = selectedRuns.map((run) => makeEventsKey(namespace, run.id));

  const storedEventsByRun = await Promise.all(
    eventKeysByRun.map(async (key) => {
      const eventHistory = await getStoredCleanupEventHistory(storage, key);

      return {
        exists: eventHistory.raw !== undefined,
        events: eventHistory.events,
      };
    }),
  );

  const runEvents = storedEventsByRun.map((entry) => entry.events);

  const eventKeysForCleanup = eventKeysByRun.map((key, index) =>
    storedEventsByRun[index]?.exists === true ? key : undefined,
  );

  const eventKeys = eventKeysForCleanup.filter((key): key is EventsKey => key !== undefined);

  const runKeys = selectedRuns.map((run): CleanupRunKey => ({
    key: makeRunKey(namespace, run.id),
    run,
  }));

  const idempotencyIndexesByRun = await Promise.all(
    selectedRuns.map((run) => idempotencyIndexesForCleanup(storage, namespace, run)),
  );

  const idempotencyKeysByRun = idempotencyIndexesByRun.map((indexes) =>
    indexes.map((index) => index.key),
  );

  const idempotencyKeys = idempotencyKeysByRun.flat();

  const messageIdempotencyIndexesByRun = await Promise.all(
    selectedRuns.map((run, index) =>
      messageIdempotencyIndexesForCleanup(storage, namespace, run.id, runEvents[index] ?? []),
    ),
  );

  const messageIdempotencyKeysByRun = messageIdempotencyIndexesByRun.map((indexes) =>
    indexes.map((index) => index.key),
  );

  const messageIdempotencyKeys = messageIdempotencyKeysByRun.flat();

  const deletionResults =
    options.dryRun === true
      ? selectedRuns.map(() => ({
          cleanupMarkerCreated: false,
          cleanupMarkerDeleted: false,
          runDeleted: false,
          deletedEvents: 0,
          deletedStepAttempts: 0,
          deletedIdempotencyKeys: 0,
          deletedMessageIdempotencyKeys: 0,
        }))
      : await deleteCleanupRunsAndArtifacts(storage, {
          namespace,
          runs: runKeys,
          eventKeysByRun: eventKeysForCleanup,
          stepAttemptKeysByRun,
          idempotencyIndexesByRun,
          messageIdempotencyIndexesByRun,
        });

  const deletedRuns = countCleanupDeletionResult(deletionResults, "runDeleted");
  const createdCleanupMarkers = countCleanupDeletionResult(deletionResults, "cleanupMarkerCreated");
  const deletedCleanupMarkers = countCleanupDeletionResult(deletionResults, "cleanupMarkerDeleted");
  const deletedEvents = sumCleanupDeletionResult(deletionResults, "deletedEvents");
  const deletedStepAttempts = sumCleanupDeletionResult(deletionResults, "deletedStepAttempts");

  const deletedIdempotencyKeys = sumCleanupDeletionResult(
    deletionResults,
    "deletedIdempotencyKeys",
  );

  const deletedMessageIdempotencyKeys = sumCleanupDeletionResult(
    deletionResults,
    "deletedMessageIdempotencyKeys",
  );

  return {
    mode: "best_effort",
    runIds: selectedRuns.map((run) => run.id),
    runs: selectedRuns.map((run, index): CleanupRunResult => {
      return {
        mode: "best_effort",
        runId: run.id,
        workflowName: run.workflowName,
        workflowVersion: run.workflowVersion,
        status: isTerminalRunStatus(run.status)
          ? run.status
          : (() => {
              WorkflowStateError.cleanupSelectedNonTerminalRun(run.id);
            })(),
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        finishedAt: cleanupFinishedAt(run),
        idempotencyKey: run.idempotencyKey,
        parentRunId: run.parentRunId,
        parentStepId: run.parentStepId,
        parentStepName: run.parentStepName,
        parentStepAttempt: run.parentStepAttempt,
        events: runEvents[index]?.length ?? 0,
        stepAttempts: stepAttemptKeysByRun[index]?.length ?? 0,
        idempotencyKeys: idempotencyKeysByRun[index]?.length ?? 0,
        messageIdempotencyKeys: messageIdempotencyKeysByRun[index]?.length ?? 0,
        cleanupMarkerCreated: deletionResults[index]?.cleanupMarkerCreated ?? false,
        cleanupMarkerDeleted: deletionResults[index]?.cleanupMarkerDeleted ?? false,
        runDeleted: deletionResults[index]?.runDeleted ?? false,
        deletedEvents: deletionResults[index]?.deletedEvents ?? 0,
        deletedStepAttempts: deletionResults[index]?.deletedStepAttempts ?? 0,
        deletedIdempotencyKeys: deletionResults[index]?.deletedIdempotencyKeys ?? 0,
        deletedMessageIdempotencyKeys: deletionResults[index]?.deletedMessageIdempotencyKeys ?? 0,
      };
    }),
    dryRun: options.dryRun === true ? true : undefined,
    matchedRuns: options.dryRun === true ? selectedRuns.length : undefined,
    matchedEvents: options.dryRun === true ? eventKeys.length : undefined,
    matchedStepAttempts: options.dryRun === true ? stepAttemptKeys.length : undefined,
    matchedIdempotencyKeys: options.dryRun === true ? idempotencyKeys.length : undefined,
    matchedMessageIdempotencyKeys:
      options.dryRun === true ? messageIdempotencyKeys.length : undefined,
    deletedRuns,
    createdCleanupMarkers,
    deletedCleanupMarkers,
    deletedEvents,
    deletedStepAttempts,
    deletedIdempotencyKeys,
    deletedMessageIdempotencyKeys,
  };
}

export async function listCleanupMarkers(
  storage: WorkflowStorage,
  namespace: string,
): Promise<readonly CleanupMarkerRecord[]> {
  const prefix = makeCleanupMarkerKeyPrefix(namespace);

  const markers = await Promise.all(
    (await storage.keys({ prefix }))
      .filter((key) => isCleanupMarkerKey(key, prefix))
      .map((key) => storage.get(key)),
  );

  return markers
    .flatMap((marker) => {
      const parsed = readableCleanupMarkerRecord(marker);

      return parsed === undefined ? [] : [parsed];
    })
    .sort(compareCleanupMarkers);
}

function isCleanupMarkerKey(key: string, prefix: string): boolean {
  return key.startsWith(prefix);
}

function compareCleanupMarkers(left: CleanupMarkerRecord, right: CleanupMarkerRecord): number {
  return (
    Temporal.Instant.compare(left.cleanupStartedAt, right.cleanupStartedAt) ||
    left.runId.localeCompare(right.runId)
  );
}

type CleanupRunDeletionCountKey = Exclude<
  keyof CleanupRunDeletionResult,
  "cleanupMarkerCreated" | "cleanupMarkerDeleted" | "runDeleted"
>;

type CleanupRunDeletionFlagKey = Extract<
  keyof CleanupRunDeletionResult,
  "cleanupMarkerCreated" | "cleanupMarkerDeleted" | "runDeleted"
>;

interface CleanupRunDeletionResult {
  readonly cleanupMarkerCreated: boolean;
  readonly cleanupMarkerDeleted: boolean;
  readonly runDeleted: boolean;
  readonly deletedEvents: number;
  readonly deletedStepAttempts: number;
  readonly deletedIdempotencyKeys: number;
  readonly deletedMessageIdempotencyKeys: number;
}

function sumCleanupDeletionResult(
  results: readonly CleanupRunDeletionResult[],
  key: CleanupRunDeletionCountKey,
): number {
  return results.reduce((total, result) => total + result[key], 0);
}

function countCleanupDeletionResult(
  results: readonly CleanupRunDeletionResult[],
  key: CleanupRunDeletionFlagKey,
): number {
  return results.filter((result) => result[key]).length;
}

function cleanupFinishedAt(run: RunRecord): Temporal.Instant {
  if (run.finishedAt === undefined) {
    throw new WorkflowStateError(`Workflow cleanup run is missing finishedAt: ${run.id}`, {
      code: WorkflowErrorCode.STATE_CLEANUP_RUN_MISSING_FINISHED_AT,
      details: { runId: run.id },
    });
  }

  return run.finishedAt;
}

function isRunEligibleForCleanup(run: RunRecord, options: CleanupRunsOptions): boolean {
  if (!isTerminalRunStatus(run.status) || run.finishedAt === undefined) {
    return false;
  }

  if (Temporal.Instant.compare(run.finishedAt, options.finishedAtBefore) >= 0) {
    return false;
  }

  return options.status === undefined || matchesCleanupStatus(run.status, options.status);
}

function matchesCleanupStatus(
  status: TerminalRunStatus,
  filter: CleanupStatusFilter | undefined,
): boolean {
  return Array.isArray(filter) ? filter.includes(status) : status === filter;
}

function compareCleanupRuns(left: RunRecord, right: RunRecord): number {
  const finishedOrder = compareOptionalTimestamps(left.finishedAt, right.finishedAt);

  if (finishedOrder !== 0) {
    return finishedOrder;
  }

  const createdOrder = compareOptionalTimestamps(left.createdAt, right.createdAt);

  if (createdOrder !== 0) {
    return createdOrder;
  }

  return left.id.localeCompare(right.id);
}

async function deleteCleanupRunsAndArtifacts(
  storage: WorkflowStorage,
  options: {
    readonly namespace: string;
    readonly runs: readonly CleanupRunKey[];
    readonly eventKeysByRun: readonly (string | undefined)[];
    readonly stepAttemptKeysByRun: readonly (readonly string[])[];
    readonly idempotencyIndexesByRun: readonly (readonly CleanupIndexKey[])[];
    readonly messageIdempotencyIndexesByRun: readonly (readonly CleanupIndexKey[])[];
  },
): Promise<readonly CleanupRunDeletionResult[]> {
  const markers = await createCleanupMarkers(storage, options);
  const deletedRuns = await deleteCleanupRunRecords(storage, options.runs);

  return await Promise.all(
    deletedRuns.map(async (runDeleted, index) => {
      const marker = markers[index];

      if (!runDeleted) {
        return {
          cleanupMarkerCreated: marker?.created ?? false,
          cleanupMarkerDeleted: false,
          runDeleted: false,
          deletedEvents: 0,
          deletedStepAttempts: 0,
          deletedIdempotencyKeys: 0,
          deletedMessageIdempotencyKeys: 0,
        };
      }

      const eventKeys =
        options.eventKeysByRun[index] === undefined ? [] : [options.eventKeysByRun[index]];

      const [
        deletedEvents,
        deletedStepAttempts,
        deletedIdempotencyKeys,
        deletedMessageIdempotencyKeys,
      ] = await Promise.all([
        storage.deleteMany(eventKeys),
        storage.deleteMany(options.stepAttemptKeysByRun[index] ?? []),
        deleteCleanupIndexes(storage, options.idempotencyIndexesByRun[index] ?? []),
        deleteCleanupIndexes(storage, options.messageIdempotencyIndexesByRun[index] ?? []),
      ]);

      const cleanupMarkerDeleted =
        marker?.key !== undefined &&
        deletionCompleted({
          deletedEvents,
          expectedEvents: eventKeys.length,
          deletedStepAttempts,
          expectedStepAttempts: options.stepAttemptKeysByRun[index]?.length ?? 0,
          deletedIdempotencyKeys,
          expectedIdempotencyKeys: options.idempotencyIndexesByRun[index]?.length ?? 0,
          deletedMessageIdempotencyKeys,
          expectedMessageIdempotencyKeys:
            options.messageIdempotencyIndexesByRun[index]?.length ?? 0,
        });

      if (cleanupMarkerDeleted) {
        await storage.delete(marker.key);
      }

      return {
        cleanupMarkerCreated: marker?.created ?? false,
        cleanupMarkerDeleted,
        runDeleted: true,
        deletedEvents,
        deletedStepAttempts,
        deletedIdempotencyKeys,
        deletedMessageIdempotencyKeys,
      };
    }),
  );
}

async function createCleanupMarkers(
  storage: WorkflowStorage,
  options: {
    readonly namespace: string;
    readonly runs: readonly CleanupRunKey[];
    readonly eventKeysByRun: readonly (string | undefined)[];
    readonly stepAttemptKeysByRun: readonly (readonly string[])[];
    readonly idempotencyIndexesByRun: readonly (readonly CleanupIndexKey[])[];
    readonly messageIdempotencyIndexesByRun: readonly (readonly CleanupIndexKey[])[];
  },
): Promise<readonly { readonly key: string; readonly created: boolean }[]> {
  const cleanupStartedAt = Temporal.Now.instant();

  return await Promise.all(
    options.runs.map(async ({ run }, index) => {
      const key = makeCleanupMarkerKey(options.namespace, run.id);

      const marker: CleanupMarkerRecord = {
        mode: "best_effort",
        runId: run.id,
        workflowName: run.workflowName,
        workflowVersion: run.workflowVersion,
        status: isTerminalRunStatus(run.status)
          ? run.status
          : (() => {
              WorkflowStateError.cleanupSelectedNonTerminalRun(run.id);
            })(),
        createdAt: run.createdAt,
        finishedAt: cleanupFinishedAt(run),
        cleanupStartedAt,
        events: options.eventKeysByRun[index] === undefined ? 0 : 1,
        stepAttempts: options.stepAttemptKeysByRun[index]?.length ?? 0,
        idempotencyKeys: options.idempotencyIndexesByRun[index]?.length ?? 0,
        messageIdempotencyKeys: options.messageIdempotencyIndexesByRun[index]?.length ?? 0,
      };

      await storage.set(key, toStorageValue(marker));

      return { key, created: true };
    }),
  );
}

function deletionCompleted(options: {
  readonly deletedEvents: number;
  readonly expectedEvents: number;
  readonly deletedStepAttempts: number;
  readonly expectedStepAttempts: number;
  readonly deletedIdempotencyKeys: number;
  readonly expectedIdempotencyKeys: number;
  readonly deletedMessageIdempotencyKeys: number;
  readonly expectedMessageIdempotencyKeys: number;
}): boolean {
  return (
    options.deletedEvents === options.expectedEvents &&
    options.deletedStepAttempts === options.expectedStepAttempts &&
    options.deletedIdempotencyKeys === options.expectedIdempotencyKeys &&
    options.deletedMessageIdempotencyKeys === options.expectedMessageIdempotencyKeys
  );
}

async function deleteCleanupRunRecords(
  storage: WorkflowStorage,
  runs: readonly CleanupRunKey[],
): Promise<readonly boolean[]> {
  if (!supportsConditionalWrite(storage)) {
    const latestRuns = await Promise.all(
      runs.map(async (run) => {
        return await getReadableStoredRun(storage, run.run.namespace, run.run.id);
      }),
    );

    const deletedRuns = latestRuns.map(
      (latest, index) =>
        latest !== undefined && deepEquals(omitUndefined(latest), omitUndefined(runs[index]!.run)),
    );

    await storage.deleteMany(
      runs.flatMap((run, index) => (deletedRuns[index] === true ? [run.key] : [])),
    );

    return deletedRuns;
  }

  return await Promise.all(
    runs.map((run) => storage.compareAndSet(run.key, toStorageValue(run.run), undefined)),
  );
}
