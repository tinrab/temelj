import type { StoreCapabilities, WorkflowStorage } from "../types/store.ts";

import { WorkflowCapabilityError } from "../errors/mod.ts";

/** Detects which coordination capabilities are available on a workflow store backend. */
export function getWorkflowStoreCapabilities(storage: WorkflowStorage): StoreCapabilities {
  const conditionalWrites = supportsConditionalWrite(storage);
  const conditionalBatches = supportsAtomicBatchWrite(storage);

  return {
    conditionalWrites,
    conditionalRunClaims: conditionalWrites,
    conditionalRunUpdates: conditionalWrites,
    conditionalRunLeaseExtensions: conditionalWrites,
    conditionalRunLeaseReleases: conditionalWrites,
    conditionalEventAppends: conditionalWrites,
    conditionalStepAttemptMaterialization: conditionalWrites,
    atomicRunCreation: conditionalBatches,
    atomicEventAndStepAttemptMaterialization: conditionalBatches,
    messageIdempotencyIndexes: true,
    indexedRunQueries: false,
    indexedRunCounts: false,
    indexedClaimableRunQueries: false,
    indexedStepAttemptQueries: false,
    indexedScheduleQueries: false,
    indexedLockQueries: false,
    rollsBackEventsOnMaterializationFailure: true,
    reconcilesStepAttemptsFromEvents: true,
  };
}

/** Validates workflow store capabilities and throws when the requirement is not met. */
export function requireStoreCapabilities(
  store: { readonly capabilities: StoreCapabilities },
  requirements: readonly (readonly [capability: keyof StoreCapabilities, label: string])[],
): void {
  for (const [capability, label] of requirements) {
    if (store.capabilities[capability] !== true) {
      WorkflowCapabilityError.unsupported(label ?? `workflow store ${capability}`);
    }
  }
}

/** Returns whether a storage backend can reject stale single-key writes. */
export function supportsConditionalWrite(storage: WorkflowStorage): boolean {
  return storage.capabilities.compareAndSet;
}

/** Returns whether a storage backend can atomically reject stale multi-key writes. */
export function supportsAtomicBatchWrite(storage: WorkflowStorage): boolean {
  return storage.capabilities.compareAndSetMany;
}
