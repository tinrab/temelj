import type { StorageValue } from "@temelj/storage";

import type { ExecutionEnvironment } from "../types/engine.ts";
import type { AttributePatch } from "../types/run.ts";
import type { StepRunDataApi } from "../types/step.ts";

import {
  normalizeAttributePatch,
  workflowAttributeEventPatch,
  workflowAttributePatchFromEvent,
} from "../attributes.ts";
import { resolveCommandIdentity } from "./command-identity.ts";
import { appendDurableEvent } from "./durable-command.ts";
import { requireAttributesReplayMatches, requireMetadataReplayMatches } from "./replay.ts";
import { toPersistedValue } from "./serialization.ts";
import { StaleExecutionError } from "./signals.ts";
import { patchCurrentExecutionRun, patchCurrentExecutionRunAttributes } from "./state.ts";

export function createRunDataApi(environment: ExecutionEnvironment): StepRunDataApi {
  return {
    async setMetadata(commandId, metadata) {
      await setRunMetadata(environment, commandId, metadata);
    },

    async setAttributes(commandId, attributes) {
      await recordRunAttributes(environment, commandId, attributes);
    },
  };
}

async function setRunMetadata(
  environment: ExecutionEnvironment,
  commandId: string,
  metadata: StorageValue,
): Promise<void> {
  const { store, history, now, limits, executionOwner } = environment;
  const identity = resolveCommandIdentity(history, "metadata", commandId);
  const persistedMetadata = toPersistedValue(metadata, "workflow run metadata", limits);
  const recorded = history.metadataSet(identity.id);

  if (recorded !== undefined) {
    requireMetadataReplayMatches(identity, recorded, persistedMetadata);

    const updated = await patchCurrentExecutionRun(store, executionOwner, {
      metadata: recorded.metadata,
      updatedAt: recorded.timestamp,
    });

    if (updated === undefined) {
      StaleExecutionError.stale(executionOwner.id);
    }

    Object.assign(executionOwner, updated);

    return;
  }

  const timestamp = now();
  await appendDurableEvent(environment, {
    kind: "metadata_set",
    timestamp,
    stepId: identity.id,
    stepName: identity.name,
    count: identity.count,
    metadata: persistedMetadata,
  });

  const updated = await patchCurrentExecutionRun(store, executionOwner, {
    metadata: persistedMetadata,
    updatedAt: timestamp,
  });

  if (updated === undefined) {
    StaleExecutionError.stale(executionOwner.id);
  }

  Object.assign(executionOwner, updated);
}

async function recordRunAttributes(
  environment: ExecutionEnvironment,
  commandId: string,
  attributes: AttributePatch,
): Promise<void> {
  const { store, history, now, executionOwner } = environment;
  const identity = resolveCommandIdentity(history, "attributes", commandId);
  const normalized = normalizeAttributePatch(attributes);
  const recorded = history.attributesSet(identity.id);

  if (recorded !== undefined) {
    requireAttributesReplayMatches(identity, recorded, normalized);
    const recordedPatch = workflowAttributePatchFromEvent(recorded);

    const updated = await patchCurrentExecutionRunAttributes(
      store,
      executionOwner,
      recordedPatch,
      recorded.timestamp,
    );

    if (updated === undefined) {
      StaleExecutionError.stale(executionOwner.id);
    }

    Object.assign(executionOwner, updated);

    return;
  }

  const timestamp = now();
  await appendDurableEvent(environment, {
    kind: "attributes_set",
    timestamp,
    stepId: identity.id,
    stepName: identity.name,
    count: identity.count,
    ...workflowAttributeEventPatch(normalized),
  });

  const updated = await patchCurrentExecutionRunAttributes(
    store,
    executionOwner,
    normalized,
    timestamp,
  );

  if (updated === undefined) {
    StaleExecutionError.stale(executionOwner.id);
  }

  Object.assign(executionOwner, updated);
}
