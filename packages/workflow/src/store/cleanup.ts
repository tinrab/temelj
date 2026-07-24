import type {
  CleanupMarkerRecord,
  CleanupRunsOptions,
  CleanupRunsResult,
  CleanupStatusFilter,
} from "../types/cleanup.ts";
import type { EventRecord } from "../types/events.ts";
import type { WorkflowListRunsOptions } from "../types/run-list.ts";
import type { RunId, WorkflowRunRecord, WorkflowTerminalRunStatus } from "../types/run.ts";
import type {
  WorkflowCleanupIndexKey,
  WorkflowCleanupIndexValue,
  WorkflowMessageIdempotencyIndex,
  WorkflowStorage,
} from "../types/store.ts";

import { omitUndefined } from "../collection.ts";
import { WorkflowStateError } from "../errors/mod.ts";
import { workflowStepAttemptKey } from "../history/mod.ts";
import {
  makeCleanupMarkerKey,
  makeCleanupMarkerKeyPrefix,
  makeEventsKey,
  makeIdempotencyKey,
  makeRunKey,
  makeMessageIdempotencyKey,
  makeStepAttemptKeyPrefix,
  MessageIdempotencyKey,
  WorkflowIdempotencyKey,
  WorkflowEventsKey,
} from "../store-keys.ts";
import { compareOptionalTimestamps } from "../temporal.ts";
import { isTerminalWorkflowRunStatus } from "../utility.ts";
import { supportsWorkflowConditionalWrite } from "./capabilities.ts";
import { getStoredCleanupEventHistory } from "./event-history.ts";
import { messageIdempotencyIndexValuesFromEvents } from "./message-index.ts";
import { isSameWorkflowStorageValue } from "./revision.ts";
import { getReadableStoredWorkflowRun } from "./run.ts";
import { toStorageValue } from "./storage-value.ts";
import {
  isReadableMessageIdempotencyIndex,
  isSameMessageIdempotencyIndex,
  readableCleanupMarkerRecord,
} from "./validation.ts";

interface WorkflowMessageIdempotencyEventIndex {
  readonly key: MessageIdempotencyKey;
  readonly value: WorkflowMessageIdempotencyIndex;
}

interface WorkflowCleanupRunKey {
  readonly key: string;
  readonly run: WorkflowRunRecord;
}

interface WorkflowCleanupRunLister {
  listRuns(options: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]>;
}

type WorkflowCleanupMarker = CleanupMarkerRecord;

export async function stepAttemptKeysForCleanup(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<readonly string[]> {
  const prefix = makeStepAttemptKeyPrefix(namespace, runId);
  return [
    ...new Set((await storage.keys({ prefix })).filter((key) => isStepAttemptKey(key, prefix))),
  ];
}

function isStepAttemptKey(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix)) {
    return false;
  }
  const attemptKey = decodeStepAttemptKey(key, prefix);
  if (attemptKey === undefined) {
    return false;
  }
  const separator = attemptKey.lastIndexOf(":");
  if (!attemptKey.startsWith("run:") || separator <= "run:".length) {
    return false;
  }
  const stepId = attemptKey.slice("run:".length, separator);
  const attempt = Number(attemptKey.slice(separator + 1));
  try {
    return workflowStepAttemptKey(stepId, attempt) === attemptKey;
  } catch {
    return false;
  }
}

function decodeStepAttemptKey(key: string, prefix: string): string | undefined {
  try {
    return decodeURIComponent(key.slice(prefix.length));
  } catch {
    return undefined;
  }
}

export async function messageIdempotencyIndexesForCleanup(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  events: readonly EventRecord[],
): Promise<readonly WorkflowCleanupIndexKey[]> {
  const candidatesByKey = new Map<string, readonly WorkflowMessageIdempotencyEventIndex[]>();
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
    .filter((entry): entry is typeof entry & { readonly value: WorkflowMessageIdempotencyIndex } =>
      isCurrentMessageIdempotencyIndex(candidatesByKey.get(entry.key) ?? [], entry.value),
    )
    .map(toCleanupIndex);
}

export async function idempotencyIndexesForCleanup(
  storage: WorkflowStorage,
  namespace: string,
  run: WorkflowRunRecord,
): Promise<readonly WorkflowCleanupIndexKey[]> {
  if (run.idempotencyKey === undefined) {
    return [];
  }
  const key = idempotencyKeyFromRun(namespace, run);
  const value = await storage.get(key);
  return value === run.id ? [{ key, value }] : [];
}

export async function deleteCleanupIndexes(
  storage: WorkflowStorage,
  indexes: readonly WorkflowCleanupIndexKey[],
): Promise<number> {
  const uniqueIndexes = indexes.filter(uniqueCleanupIndexKey);
  if (!supportsWorkflowConditionalWrite(storage)) {
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
    uniqueIndexes.map(
      async (index) => await storage.compareAndSet(index.key, index.value, undefined),
    ),
  );
  return deleted.filter((value) => value).length;
}

function workflowCleanupIndexMatchesCurrentValue(
  current: unknown,
  expected: WorkflowCleanupIndexValue,
): boolean {
  if (isReadableMessageIdempotencyIndex(expected)) {
    return isSameMessageIdempotencyIndex(current, expected);
  }
  return isSameWorkflowStorageValue(current, expected);
}

function messageIdempotencyIndexesFromEvents(
  namespace: string,
  runId: RunId,
  events: readonly EventRecord[],
): readonly WorkflowMessageIdempotencyEventIndex[] {
  return messageIdempotencyIndexValuesFromEvents(events, runId).map(
    ({ idempotencyKey, value }) => ({
      key: makeMessageIdempotencyKey(namespace, runId, idempotencyKey),
      value,
    }),
  );
}

function idempotencyKeyFromRun(namespace: string, run: WorkflowRunRecord): WorkflowIdempotencyKey {
  if (run.idempotencyKey === undefined) {
    WorkflowStateError.runMissingIdempotencyKey(run.id);
  }
  return makeIdempotencyKey(namespace, {
    workflowName: run.workflowName,
    ...(run.workflowVersion === undefined ? {} : { workflowVersion: run.workflowVersion }),
    idempotencyKey: run.idempotencyKey,
  });
}

function toCleanupIndex(entry: {
  readonly key: string;
  readonly value: WorkflowMessageIdempotencyIndex;
}): WorkflowCleanupIndexKey {
  return {
    key: entry.key,
    value: toStorageValue(entry.value),
  };
}

function isCurrentMessageIdempotencyIndex(
  eventIndexes: readonly WorkflowMessageIdempotencyEventIndex[],
  value: unknown,
): value is WorkflowMessageIdempotencyIndex {
  if (!isReadableMessageIdempotencyIndex(value)) {
    return false;
  }
  return eventIndexes.some((eventIndex) => isSameMessageIdempotencyIndex(value, eventIndex.value));
}

function uniqueCleanupIndexKey(
  index: WorkflowCleanupIndexKey,
  position: number,
  indexes: readonly WorkflowCleanupIndexKey[],
): boolean {
  return indexes.findIndex((current) => current.key === index.key) === position;
}

export async function cleanupRuns(
  storage: WorkflowStorage,
  namespace: string,
  runs: WorkflowCleanupRunLister,
  options: CleanupRunsOptions,
): Promise<CleanupRunsResult> {
  const cleanupOptions = options;
  const limit = cleanupOptions.limit;
  const statusFilter = cleanupOptions.status ?? ["completed", "failed", "canceled"];
  const selectedRuns = (
    await runs.listRuns({
      status: Array.isArray(statusFilter) ? [...statusFilter] : statusFilter,
      workflowName: cleanupOptions.workflowName,
      workflowVersion: cleanupOptions.workflowVersion,
      idempotencyKey: cleanupOptions.idempotencyKey,
      parentRunId: cleanupOptions.parentRunId,
      parentStepId: cleanupOptions.parentStepId,
      parentStepName: cleanupOptions.parentStepName,
      parentStepAttempt: cleanupOptions.parentStepAttempt,
    })
  )
    .filter((run) => isWorkflowRunEligibleForCleanup(run, cleanupOptions))
    .sort(compareCleanupRuns)
    .filter(isFirstCleanupRunForId)
    .slice(0, limit);

  const stepAttemptKeysByRun = await Promise.all(
    selectedRuns.map(async (run) => await stepAttemptKeysForCleanup(storage, namespace, run.id)),
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
  const eventKeys = eventKeysForCleanup.filter(
    (key): key is WorkflowEventsKey => key !== undefined,
  );
  const runKeys = selectedRuns.map(
    (run): WorkflowCleanupRunKey => ({ key: makeRunKey(namespace, run.id), run }),
  );
  const idempotencyIndexesByRun = await Promise.all(
    selectedRuns.map(async (run) => await idempotencyIndexesForCleanup(storage, namespace, run)),
  );
  const idempotencyKeysByRun = idempotencyIndexesByRun.map((indexes) =>
    indexes.map((index) => index.key),
  );
  const idempotencyKeys = idempotencyKeysByRun.flat();
  const messageIdempotencyIndexesByRun = await Promise.all(
    selectedRuns.map(
      async (run, index) =>
        await messageIdempotencyIndexesForCleanup(
          storage,
          namespace,
          run.id,
          runEvents[index] ?? [],
        ),
    ),
  );
  const messageIdempotencyKeysByRun = messageIdempotencyIndexesByRun.map((indexes) =>
    indexes.map((index) => index.key),
  );
  const messageIdempotencyKeys = messageIdempotencyKeysByRun.flat();

  const deletionResults =
    cleanupOptions.dryRun === true
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
    runs: selectedRuns.map((run, index) => ({
      mode: "best_effort",
      runId: run.id,
      workflowName: run.workflowName,
      ...(run.workflowVersion === undefined ? {} : { workflowVersion: run.workflowVersion }),
      status: isTerminalWorkflowRunStatus(run.status)
        ? run.status
        : (() => {
            WorkflowStateError.cleanupSelectedNonTerminalRun(run.id);
          })(),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      finishedAt: cleanupFinishedAt(run),
      ...(run.idempotencyKey === undefined ? {} : { idempotencyKey: run.idempotencyKey }),
      ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }),
      ...(run.parentStepId === undefined ? {} : { parentStepId: run.parentStepId }),
      ...(run.parentStepName === undefined ? {} : { parentStepName: run.parentStepName }),
      ...(run.parentStepAttempt === undefined ? {} : { parentStepAttempt: run.parentStepAttempt }),
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
    })),
    ...(cleanupOptions.dryRun === true
      ? {
          dryRun: true,
          matchedRuns: selectedRuns.length,
          matchedEvents: eventKeys.length,
          matchedStepAttempts: stepAttemptKeys.length,
          matchedIdempotencyKeys: idempotencyKeys.length,
          matchedMessageIdempotencyKeys: messageIdempotencyKeys.length,
        }
      : {}),
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
      .map(async (key) => await storage.get(key)),
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

type WorkflowCleanupRunDeletionCountKey = Exclude<
  keyof WorkflowCleanupRunDeletionResult,
  "cleanupMarkerCreated" | "cleanupMarkerDeleted" | "runDeleted"
>;
type WorkflowCleanupRunDeletionFlagKey = Extract<
  keyof WorkflowCleanupRunDeletionResult,
  "cleanupMarkerCreated" | "cleanupMarkerDeleted" | "runDeleted"
>;

interface WorkflowCleanupRunDeletionResult {
  readonly cleanupMarkerCreated: boolean;
  readonly cleanupMarkerDeleted: boolean;
  readonly runDeleted: boolean;
  readonly deletedEvents: number;
  readonly deletedStepAttempts: number;
  readonly deletedIdempotencyKeys: number;
  readonly deletedMessageIdempotencyKeys: number;
}

function sumCleanupDeletionResult(
  results: readonly WorkflowCleanupRunDeletionResult[],
  key: WorkflowCleanupRunDeletionCountKey,
): number {
  return results.reduce((total, result) => total + result[key], 0);
}

function countCleanupDeletionResult(
  results: readonly WorkflowCleanupRunDeletionResult[],
  key: WorkflowCleanupRunDeletionFlagKey,
): number {
  return results.filter((result) => result[key]).length;
}

function cleanupFinishedAt(run: WorkflowRunRecord): Temporal.Instant {
  if (run.finishedAt === undefined) {
    WorkflowStateError.cleanupRunMissingFinishedAt(run.id);
  }
  return run.finishedAt;
}

function isWorkflowRunEligibleForCleanup(
  run: WorkflowRunRecord,
  options: CleanupRunsOptions,
): boolean {
  if (!isTerminalWorkflowRunStatus(run.status) || run.finishedAt === undefined) {
    return false;
  }
  if (Temporal.Instant.compare(run.finishedAt, options.finishedAtBefore) >= 0) {
    return false;
  }
  return options.status === undefined || matchesCleanupStatus(run.status, options.status);
}

function matchesCleanupStatus(
  status: WorkflowTerminalRunStatus,
  filter: CleanupStatusFilter | undefined,
): boolean {
  return Array.isArray(filter) ? filter.includes(status) : status === filter;
}

function compareCleanupRuns(left: WorkflowRunRecord, right: WorkflowRunRecord): number {
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

function isFirstCleanupRunForId(
  run: WorkflowRunRecord,
  index: number,
  runs: readonly WorkflowRunRecord[],
): boolean {
  return runs.findIndex((entry) => entry.id === run.id) === index;
}

async function deleteCleanupRunsAndArtifacts(
  storage: WorkflowStorage,
  options: {
    readonly namespace: string;
    readonly runs: readonly WorkflowCleanupRunKey[];
    readonly eventKeysByRun: readonly (string | undefined)[];
    readonly stepAttemptKeysByRun: readonly (readonly string[])[];
    readonly idempotencyIndexesByRun: readonly (readonly WorkflowCleanupIndexKey[])[];
    readonly messageIdempotencyIndexesByRun: readonly (readonly WorkflowCleanupIndexKey[])[];
  },
): Promise<readonly WorkflowCleanupRunDeletionResult[]> {
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
    readonly runs: readonly WorkflowCleanupRunKey[];
    readonly eventKeysByRun: readonly (string | undefined)[];
    readonly stepAttemptKeysByRun: readonly (readonly string[])[];
    readonly idempotencyIndexesByRun: readonly (readonly WorkflowCleanupIndexKey[])[];
    readonly messageIdempotencyIndexesByRun: readonly (readonly WorkflowCleanupIndexKey[])[];
  },
): Promise<readonly { readonly key: string; readonly created: boolean }[]> {
  const cleanupStartedAt = Temporal.Now.instant();
  return await Promise.all(
    options.runs.map(async ({ run }, index) => {
      const key = makeCleanupMarkerKey(options.namespace, run.id);
      const marker: WorkflowCleanupMarker = {
        mode: "best_effort",
        runId: run.id,
        workflowName: run.workflowName,
        ...(run.workflowVersion === undefined ? {} : { workflowVersion: run.workflowVersion }),
        status: isTerminalWorkflowRunStatus(run.status)
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
  runs: readonly WorkflowCleanupRunKey[],
): Promise<readonly boolean[]> {
  if (!supportsWorkflowConditionalWrite(storage)) {
    const latestRuns = await Promise.all(
      runs.map(async (run) => {
        return await getReadableStoredWorkflowRun(storage, run.run.namespace, run.run.id);
      }),
    );
    const deletedRuns = latestRuns.map(
      (latest, index) =>
        latest !== undefined &&
        isSameWorkflowStorageValue(omitUndefined(latest), omitUndefined(runs[index]!.run)),
    );
    await storage.deleteMany(
      runs.flatMap((run, index) => (deletedRuns[index] === true ? [run.key] : [])),
    );
    return deletedRuns;
  }

  return await Promise.all(
    runs.map(
      async (run) => await storage.compareAndSet(run.key, toStorageValue(run.run), undefined),
    ),
  );
}
