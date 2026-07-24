import type { EventRecord } from "../types/events.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowStorage } from "../types/store.ts";

import {
  createWorkflowAppendProjectionPipeline,
  WorkflowAppendProjectionPipeline,
} from "./append-projection.ts";
import {
  supportsWorkflowAtomicBatchWrite,
  supportsWorkflowConditionalWrite,
} from "./capabilities.ts";
import {
  appendEventIfCurrent,
  appendEventIfRunRevisionCurrentAtomically,
  appendEventWithAtomicProjectionPlan,
  makeStaleRunAppendOutcome,
  type WorkflowEventAppendOutcome,
  type WorkflowEventAppendSuccessOutcome,
  type WorkflowEventAppendedOutcome,
} from "./event-append.ts";
import { duplicateMessageAppendOutcome } from "./message-index.ts";
import {
  isStoredWorkflowRunRevisionCurrent,
  isWorkflowRunStaleForAppend,
  rollbackAppendedEventIfRunStale,
} from "./run.ts";

export interface WorkflowEventAppendProjectionOutcome {
  readonly outcome: WorkflowEventAppendOutcome;
  readonly projectionPipeline?: WorkflowAppendProjectionPipeline;
}

export async function appendEventWithProjections(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  projectionPipeline?: WorkflowAppendProjectionPipeline,
): Promise<WorkflowEventAppendSuccessOutcome> {
  const appendProjectionPipeline =
    projectionPipeline ??
    (await createWorkflowAppendProjectionPipeline(storage, namespace, runId, event));
  const outcome = await appendEventWithAtomicProjectionPlan(
    storage,
    namespace,
    runId,
    event,
    appendProjectionPipeline.planAtomicProjections,
    duplicateMessageAppendOutcome,
  );
  await appendProjectionPipeline.finalizePostCommit(outcome);
  return outcome;
}

export async function appendEventWithProjectionPipelineIfRunCurrent(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: WorkflowRunRecord,
  event: EventRecord,
): Promise<WorkflowEventAppendProjectionOutcome> {
  const runId = currentRun.id;
  if (isWorkflowRunStaleForAppend(currentRun, event)) {
    return { outcome: makeStaleRunAppendOutcome() };
  }

  const projectionPipeline = await createWorkflowAppendProjectionPipeline(
    storage,
    namespace,
    runId,
    event,
  );
  if (event.kind === "message_sent" && !supportsWorkflowAtomicBatchWrite(storage)) {
    return await appendMessageEventIfRunCurrent(
      storage,
      namespace,
      currentRun,
      event,
      projectionPipeline,
    );
  }
  if (!supportsWorkflowAtomicBatchWrite(storage) || projectionPipeline.materializesAtomically) {
    const outcome = await appendEventIfRunRevisionCurrentWithPostAppendGuard(
      storage,
      namespace,
      currentRun,
      event,
      projectionPipeline,
    );
    return workflowEventAppendProjectionOutcome(outcome, projectionPipeline);
  }

  const outcome = await appendEventIfRunRevisionCurrentAtomically(
    storage,
    namespace,
    currentRun,
    event,
    duplicateMessageAppendOutcome,
  );
  return workflowEventAppendProjectionOutcome(outcome, projectionPipeline);
}

function workflowEventAppendProjectionOutcome(
  outcome: WorkflowEventAppendOutcome,
  projectionPipeline?: WorkflowAppendProjectionPipeline,
): WorkflowEventAppendProjectionOutcome {
  if (projectionPipeline === undefined) {
    return { outcome };
  }
  return { outcome, projectionPipeline };
}

async function appendEventIfRunRevisionCurrentWithPostAppendGuard(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: WorkflowRunRecord,
  event: EventRecord,
  projectionPipeline?: WorkflowAppendProjectionPipeline,
): Promise<WorkflowEventAppendOutcome> {
  const runId = currentRun.id;
  if (!(await isStoredWorkflowRunRevisionCurrent(storage, namespace, currentRun))) {
    return makeStaleRunAppendOutcome();
  }
  const outcome = await appendEventWithProjections(
    storage,
    namespace,
    runId,
    event,
    projectionPipeline,
  );
  if (outcome.status !== "appended") {
    return outcome;
  }
  return await guardAppendedEventAgainstStaleRun(storage, namespace, runId, event, outcome);
}

async function appendMessageEventIfRunCurrent(
  storage: WorkflowStorage,
  namespace: string,
  currentRun: WorkflowRunRecord,
  event: EventRecord,
  projectionPipeline: WorkflowAppendProjectionPipeline,
): Promise<WorkflowEventAppendProjectionOutcome> {
  const runId = currentRun.id;
  if (!(await isStoredWorkflowRunRevisionCurrent(storage, namespace, currentRun))) {
    return { outcome: makeStaleRunAppendOutcome() };
  }

  if (!supportsWorkflowConditionalWrite(storage)) {
    const outcome = await appendEventWithProjections(
      storage,
      namespace,
      runId,
      event,
      projectionPipeline,
    );
    if (outcome.status !== "appended") {
      return { outcome, projectionPipeline };
    }
    return {
      outcome: await guardAppendedEventAgainstStaleRun(storage, namespace, runId, event, outcome),
      projectionPipeline,
    };
  }

  const outcome = await appendEventIfCurrent(storage, namespace, runId, event, {
    detectDuplicate: duplicateMessageAppendOutcome,
  });
  if (outcome.status !== "appended") {
    if (!(await isStoredWorkflowRunRevisionCurrent(storage, namespace, currentRun))) {
      return { outcome: makeStaleRunAppendOutcome(), projectionPipeline };
    }
    return { outcome, projectionPipeline };
  }
  if (!(await isStoredWorkflowRunRevisionCurrent(storage, namespace, currentRun))) {
    await guardAppendedEventAgainstStaleRun(storage, namespace, runId, event, outcome);
    return { outcome: makeStaleRunAppendOutcome(), projectionPipeline };
  }

  return {
    outcome: await guardAppendedEventAgainstStaleRun(storage, namespace, runId, event, outcome),
    projectionPipeline,
  };
}

async function guardAppendedEventAgainstStaleRun(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  outcome: WorkflowEventAppendedOutcome,
): Promise<WorkflowEventAppendOutcome> {
  if (await rollbackAppendedEventIfRunStale(storage, namespace, runId, event, outcome.events)) {
    return makeStaleRunAppendOutcome();
  }
  return outcome;
}
