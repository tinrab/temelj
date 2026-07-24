import type { WorkflowExecutionEnvironment } from "../types/engine.ts";
import type { WorkflowAttributePatch } from "../types/run.ts";
import type { WorkflowStepRunDataApi } from "../types/step.ts";

import {
  normalizeWorkflowAttributePatch,
  workflowAttributeEventPatch,
  workflowAttributePatchFromEvent,
} from "../attributes.ts";
import { resolveWorkflowCommandIdentity } from "./command-identity.ts";
import { requireAttributesReplayMatches, requireMetadataReplayMatches } from "./replay.ts";
import { toPersistedValue } from "./serialization.ts";
import {
  appendEventIfCurrentExecution,
  patchCurrentExecutionRun,
  patchCurrentExecutionRunAttributes,
  WorkflowStaleExecutionError,
} from "./state.ts";

export function createWorkflowRunDataApi(
  environment: WorkflowExecutionEnvironment,
): WorkflowStepRunDataApi {
  return {
    async setMetadata(commandId, metadata) {
      await setWorkflowRunMetadata(environment, commandId, metadata);
    },

    async setAttributes(commandId, attributes) {
      await setWorkflowRunAttributes(environment, commandId, attributes);
    },
  };
}

export async function setWorkflowRunMetadata(
  environment: WorkflowExecutionEnvironment,
  commandId: string,
  metadata: unknown,
): Promise<void> {
  const { store, runId, history, now, limits, executionOwner } = environment;
  const identity = resolveWorkflowCommandIdentity(history, "metadata", commandId);
  const persistedMetadata = toPersistedValue(metadata, "workflow run metadata", limits);
  const recorded = history.metadataSet(identity.id);
  if (recorded !== undefined) {
    requireMetadataReplayMatches(identity, recorded, persistedMetadata);
    const updated = await patchCurrentExecutionRun(store, executionOwner, {
      metadata: recorded.metadata,
      updatedAt: recorded.timestamp,
    });
    if (updated === undefined) {
      WorkflowStaleExecutionError.stale(executionOwner.id);
    }
    Object.assign(executionOwner, updated);
    return;
  }
  const timestamp = now();
  await appendEventIfCurrentExecution(
    store,
    history,
    {
      kind: "metadata_set",
      timestamp,
      stepId: identity.id,
      stepName: identity.name,
      count: identity.count,
      metadata: persistedMetadata,
    },
    executionOwner,
    limits,
    undefined,
    (event, events) => environment.observeDurableEventAppended?.(runId, event, events),
  );
  const updated = await patchCurrentExecutionRun(store, executionOwner, {
    metadata: persistedMetadata,
    updatedAt: timestamp,
  });
  if (updated === undefined) {
    WorkflowStaleExecutionError.stale(executionOwner.id);
  }
  Object.assign(executionOwner, updated);
}

export async function setWorkflowRunAttributes(
  environment: WorkflowExecutionEnvironment,
  commandId: string,
  attributes: WorkflowAttributePatch,
): Promise<void> {
  const { store, runId, history, now, limits, executionOwner } = environment;
  const identity = resolveWorkflowCommandIdentity(history, "attributes", commandId);
  const normalized = normalizeWorkflowAttributePatch(attributes);
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
      WorkflowStaleExecutionError.stale(executionOwner.id);
    }
    Object.assign(executionOwner, updated);
    return;
  }
  const timestamp = now();
  await appendEventIfCurrentExecution(
    store,
    history,
    {
      kind: "attributes_set",
      timestamp,
      stepId: identity.id,
      stepName: identity.name,
      count: identity.count,
      ...workflowAttributeEventPatch(normalized),
    },
    executionOwner,
    limits,
    undefined,
    (event, events) => environment.observeDurableEventAppended?.(runId, event, events),
  );
  const updated = await patchCurrentExecutionRunAttributes(
    store,
    executionOwner,
    normalized,
    timestamp,
  );
  if (updated === undefined) {
    WorkflowStaleExecutionError.stale(executionOwner.id);
  }
  Object.assign(executionOwner, updated);
}
