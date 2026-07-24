import type { EventRecord } from "../types/events.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowStorage } from "../types/store.ts";
import type {
  WorkflowEventAppendOutcome,
  WorkflowEventAppendSuccessOutcome,
} from "./event-append.ts";

import { WorkflowStateError } from "../errors/base.ts";
import { makeEventsKey } from "../store-keys.ts";
import {
  createWorkflowAppendProjectionPipeline,
  WorkflowAppendProjectionPipeline,
} from "./append-projection.ts";
import {
  appendEventWithProjectionPipelineIfRunCurrent,
  appendEventWithProjections,
} from "./event-append-project.ts";
import { getStoredEventHistory } from "./event-history.ts";
import { requireReadableStoredWorkflowRun } from "./run.ts";
import { requireReadableStoreRun } from "./validation.ts";

function finalizeWorkflowAppendOutcome(
  outcome: WorkflowEventAppendSuccessOutcome,
  projectionPipeline: WorkflowAppendProjectionPipeline,
): Promise<readonly EventRecord[]>;
function finalizeWorkflowAppendOutcome(
  outcome: WorkflowEventAppendOutcome,
  projectionPipeline?: WorkflowAppendProjectionPipeline,
): Promise<readonly EventRecord[] | undefined>;
async function finalizeWorkflowAppendOutcome(
  outcome: WorkflowEventAppendOutcome,
  projectionPipeline?: WorkflowAppendProjectionPipeline,
): Promise<readonly EventRecord[] | undefined> {
  if (outcome.status === "staleRun") {
    return undefined;
  }
  if (projectionPipeline === undefined) {
    WorkflowStateError.appendProjectionPipelineMissing();
  }
  return await projectionPipeline.finalize(outcome);
}

export async function appendWorkflowEvent(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
): Promise<readonly EventRecord[]> {
  await requireReadableStoredWorkflowRun(storage, namespace, runId);
  const projectionPipeline = await createWorkflowAppendProjectionPipeline(
    storage,
    namespace,
    runId,
    event,
  );
  const outcome = await appendEventWithProjections(
    storage,
    namespace,
    runId,
    event,
    projectionPipeline,
  );
  return await finalizeWorkflowAppendOutcome(outcome, projectionPipeline);
}

export async function appendWorkflowEventIfRunCurrent(
  storage: WorkflowStorage,
  namespace: string,
  current: WorkflowRunRecord,
  event: EventRecord,
): Promise<readonly EventRecord[] | undefined> {
  requireReadableStoreRun(current, namespace);
  const appendOutcome = await appendEventWithProjectionPipelineIfRunCurrent(
    storage,
    namespace,
    current,
    event,
  );
  return await finalizeWorkflowAppendOutcome(
    appendOutcome.outcome,
    appendOutcome.projectionPipeline,
  );
}

export async function getWorkflowEvents(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
): Promise<readonly EventRecord[]> {
  return (await getStoredEventHistory(storage, makeEventsKey(namespace, runId))).events;
}
