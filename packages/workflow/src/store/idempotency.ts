import type { StorageValue } from "@temelj/storage";

import type { WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowIdempotencyKeyOptions, WorkflowStorage } from "../types/store.ts";

import { WorkflowStateError } from "../errors/mod.ts";
import { makeEventsKey, makeIdempotencyKey, makeRunKey } from "../store-keys.ts";
import {
  supportsWorkflowAtomicBatchWrite,
  supportsWorkflowConditionalWrite,
} from "./capabilities.ts";
import { toStorageValue } from "./storage-value.ts";
import { isReadableWorkflowRunRecord } from "./validation.ts";

const MAX_IDEMPOTENT_CREATE_WAIT_ATTEMPTS = 16;

interface WorkflowIdempotencyRunReader {
  getRun(runId: string): Promise<WorkflowRunRecord | undefined>;
}

type WorkflowIdempotencyClaim =
  | {
      readonly status: "claimed";
      readonly key: string;
      readonly value: StorageValue;
    }
  | {
      readonly status: "existing";
      readonly run: WorkflowRunRecord;
    };

interface WorkflowRunCreationClaim {
  readonly eventsKey?: string;
  readonly runKey?: string;
}

export async function createRunWithIdempotency(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowIdempotencyRunReader,
  run: WorkflowRunRecord,
): Promise<WorkflowRunRecord> {
  if (run.namespace !== namespace) {
    throw WorkflowStateError.runNamespaceMismatch(String(run.namespace), namespace);
  }

  const keyOptions = idempotencyKeyOptionsForRun(run);
  if (supportsWorkflowAtomicBatchWrite(storage)) {
    return await createRunAtomicallyWithIdempotency(storage, namespace, store, run, keyOptions);
  }

  const idempotencyClaim =
    keyOptions === undefined
      ? undefined
      : await claimWorkflowIdempotencyIndex(storage, namespace, store, run, keyOptions);
  if (idempotencyClaim?.status === "existing") {
    return idempotencyClaim.run;
  }

  if (keyOptions !== undefined) {
    assertWorkflowIdempotencyClaimed(run.id, idempotencyClaim);
  }

  try {
    await createRunRecordAndEventHistory(storage, namespace, run);
    return run;
  } catch (error) {
    await rollbackWorkflowIdempotencyClaim(storage, idempotencyClaim);
    throw error;
  }
}

async function createRunRecordAndEventHistory(
  storage: WorkflowStorage,
  namespace: string,
  run: WorkflowRunRecord,
): Promise<WorkflowRunCreationClaim> {
  const runKey = makeRunKey(namespace, run.id);
  const eventsKey = makeEventsKey(namespace, run.id);
  let claim: WorkflowRunCreationClaim = {};
  try {
    if (!supportsWorkflowConditionalWrite(storage)) {
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
  claim: WorkflowRunCreationClaim,
): Promise<void> {
  await storage.deleteMany([
    ...(claim.runKey === undefined ? [] : [claim.runKey]),
    ...(claim.eventsKey === undefined ? [] : [claim.eventsKey]),
  ]);
}

async function rollbackWorkflowIdempotencyClaim(
  storage: WorkflowStorage,
  claim: WorkflowIdempotencyClaim | undefined,
): Promise<void> {
  if (claim?.status !== "claimed") {
    return;
  }
  if (!supportsWorkflowConditionalWrite(storage)) {
    await storage.delete(claim.key);
    return;
  }
  await storage.compareAndSet(claim.key, claim.value, undefined);
}

async function claimWorkflowIdempotencyIndex(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowIdempotencyRunReader,
  run: WorkflowRunRecord,
  keyOptions: WorkflowIdempotencyKeyOptions,
): Promise<WorkflowIdempotencyClaim> {
  const key = makeIdempotencyKey(namespace, keyOptions);
  const value = toStorageValue(run.id);
  if (!supportsWorkflowConditionalWrite(storage)) {
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
  if (!(await releaseStaleWorkflowIdempotencyIndex(storage, namespace, store, keyOptions))) {
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

function assertWorkflowIdempotencyClaimed(
  runId: string,
  claim: WorkflowIdempotencyClaim | undefined,
): asserts claim is Extract<WorkflowIdempotencyClaim, { readonly status: "claimed" }> {
  if (claim?.status !== "claimed") {
    WorkflowStateError.idempotencyKeyClaimedWithoutRun(runId);
  }
}

async function createRunAtomicallyWithIdempotency(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowIdempotencyRunReader,
  run: WorkflowRunRecord,
  keyOptions: WorkflowIdempotencyKeyOptions | undefined,
): Promise<WorkflowRunRecord> {
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
      (await releaseStaleWorkflowIdempotencyIndex(storage, namespace, store, keyOptions))
    ) {
      continue;
    }
    WorkflowStateError.idempotencyKeyClaimedWithoutRun(run.id);
  }
  throw WorkflowStateError.runIdAlreadyExists(run.id);
}

function atomicIdempotencyClaimItems(
  namespace: string,
  run: WorkflowRunRecord,
  keyOptions: WorkflowIdempotencyKeyOptions | undefined,
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
  store: WorkflowIdempotencyRunReader,
  options: WorkflowIdempotencyKeyOptions,
): Promise<WorkflowRunRecord | undefined> {
  const runId = await storage.get(makeIdempotencyKey(namespace, options));
  if (!(typeof runId === "string" && runId.trim() !== "")) {
    return undefined;
  }
  const run = await store.getRun(runId);
  return run !== undefined &&
    isReadableWorkflowRunRecord(run, run.namespace) &&
    run.workflowName === options.workflowName &&
    run.workflowVersion === options.workflowVersion &&
    run.idempotencyKey === options.idempotencyKey
    ? run
    : undefined;
}

function idempotencyKeyOptionsForRun(
  run: WorkflowRunRecord,
): WorkflowIdempotencyKeyOptions | undefined {
  return run.idempotencyKey === undefined
    ? undefined
    : {
        workflowName: run.workflowName,
        ...(run.workflowVersion === undefined ? {} : { workflowVersion: run.workflowVersion }),
        idempotencyKey: run.idempotencyKey,
      };
}

async function waitForRunByIdempotencyKey(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowIdempotencyRunReader,
  options: WorkflowIdempotencyKeyOptions,
): Promise<WorkflowRunRecord | undefined> {
  for (let attempt = 0; attempt < MAX_IDEMPOTENT_CREATE_WAIT_ATTEMPTS; attempt++) {
    const run = await getRunByIdempotencyKey(storage, namespace, store, options);
    if (run !== undefined) {
      return run;
    }
    await Promise.resolve();
  }
  return undefined;
}

async function releaseStaleWorkflowIdempotencyIndex(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowIdempotencyRunReader,
  options: WorkflowIdempotencyKeyOptions,
): Promise<boolean> {
  if (!supportsWorkflowConditionalWrite(storage)) {
    return false;
  }
  const key = makeIdempotencyKey(namespace, options);
  const value = await storage.get(key);
  if (value === undefined) {
    return false;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const run = await store.getRun(value);
    if (
      run !== undefined &&
      isReadableWorkflowRunRecord(run, run.namespace) &&
      run.workflowName === options.workflowName &&
      run.workflowVersion === options.workflowVersion &&
      run.idempotencyKey === options.idempotencyKey
    ) {
      return false;
    }
  }
  return await storage.compareAndSet(key, value, undefined);
}
