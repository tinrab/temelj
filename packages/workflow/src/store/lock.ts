import type { LockRecord } from "../types/lock.ts";
import type { WorkflowStorage } from "../types/store.ts";

import { WorkflowLockStateError } from "../errors/mod.ts";
import { makeLockKey, makeLockKeyPrefix } from "../store-keys.ts";
import { compactWorkflowStoreRecord } from "./compaction.ts";
import { toStorageValue } from "./storage-value.ts";
import { isReadableLockRecord } from "./validation.ts";

export async function getReadableLock(
  storage: WorkflowStorage,
  namespace: string,
  key: string,
): Promise<LockRecord | undefined> {
  const lock = await storage.get(makeLockKey(namespace, key));
  return isReadableLockRecord(lock, namespace) ? lock : undefined;
}

export async function listReadableLocks(
  storage: WorkflowStorage,
  namespace: string,
): Promise<readonly LockRecord[]> {
  return (await storage.entries({ prefix: makeLockKeyPrefix(namespace) }))
    .map((entry: { readonly value: unknown }) => entry.value)
    .filter((lock): lock is LockRecord => isReadableLockRecord(lock, namespace))
    .sort((a, b) => a.key.localeCompare(b.key))
    .filter(isFirstLockRecordForKey);
}

export async function updateLockIfCurrent(
  storage: WorkflowStorage,
  namespace: string,
  current: LockRecord | undefined,
  next: LockRecord,
): Promise<LockRecord | undefined> {
  if (next.namespace !== namespace) {
    WorkflowLockStateError.namespaceMismatch(String(next.namespace), namespace);
  }
  if (current !== undefined) {
    if (current.namespace !== namespace) {
      WorkflowLockStateError.namespaceMismatch(String(current.namespace), namespace);
    }
    if (current.key !== next.key) {
      WorkflowLockStateError.keyChangeRejected();
    }
  }
  const compact = compactWorkflowStoreRecord(next);
  const updated = await storage.compareAndSet(
    makeLockKey(namespace, next.key),
    current === undefined ? undefined : toStorageValue(current),
    toStorageValue(compact),
  );
  return updated ? compact : undefined;
}

function isFirstLockRecordForKey(
  lock: LockRecord,
  index: number,
  locks: readonly LockRecord[],
): boolean {
  return locks.findIndex((entry) => entry.key === lock.key) === index;
}
