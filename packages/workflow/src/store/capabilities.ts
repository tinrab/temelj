import type { WorkflowStoreCapabilities, WorkflowStorage } from "../types/store.ts";

import { WorkflowCapabilityError } from "../errors/mod.ts";

/** Detects which coordination capabilities are available on a workflow store backend. */
export function getWorkflowStoreCapabilities(storage: WorkflowStorage): WorkflowStoreCapabilities {
  const conditionalWrites = supportsWorkflowConditionalWrite(storage);
  const conditionalBatches = supportsWorkflowAtomicBatchWrite(storage);
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
export function requireWorkflowStoreCapabilities(
  store: { readonly capabilities: WorkflowStoreCapabilities },
  requirements: Partial<Record<keyof WorkflowStoreCapabilities, string>>,
): void {
  for (const [capability, label] of Object.entries(requirements) as Array<
    [keyof WorkflowStoreCapabilities, string | undefined]
  >) {
    if (store.capabilities[capability] !== true) {
      WorkflowCapabilityError.unsupported(label ?? `workflow store ${capability}`);
    }
  }
}

/** Returns whether a storage backend can reject stale single-key writes. */
export function supportsWorkflowConditionalWrite(storage: WorkflowStorage): boolean {
  return storage.capabilities.compareAndSet;
}

/** Returns whether a storage backend can atomically reject stale multi-key writes. */
export function supportsWorkflowAtomicBatchWrite(storage: WorkflowStorage): boolean {
  return storage.capabilities.compareAndSetMany;
}
