import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/run.ts";
import type { WorkflowStorage } from "../types/store.ts";
import type {
  WorkflowEventAppendAtomicProjectionPlanner,
  WorkflowEventAppendSuccessOutcome,
} from "./event-append.ts";
import type { WorkflowStepAttemptMaterializationStoragePlan } from "./materialization.ts";

import { supportsWorkflowAtomicBatchWrite } from "./capabilities.ts";
import {
  createWorkflowStepAttemptMaterializationStoragePlan,
  materializeStepAttemptForAppendOutcome,
} from "./materialization.ts";
import { projectMessageIdempotencyIndexForAppendOutcome } from "./message-index.ts";

export interface WorkflowAppendProjectionPipeline {
  readonly materializesAtomically: boolean;
  readonly planAtomicProjections?: WorkflowEventAppendAtomicProjectionPlanner;
  finalize(outcome: WorkflowEventAppendSuccessOutcome): Promise<readonly EventRecord[]>;
  finalizePostCommit(outcome: WorkflowEventAppendSuccessOutcome): Promise<void>;
}

export async function createWorkflowAppendProjectionPipeline(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
): Promise<WorkflowAppendProjectionPipeline> {
  if (!supportsWorkflowAtomicBatchWrite(storage)) {
    return createWorkflowAppendProjectionPipelineFromStepAttemptPlan(
      storage,
      namespace,
      runId,
      event,
      undefined,
    );
  }
  const initialStepAttemptPlan = await createWorkflowStepAttemptMaterializationStoragePlan(
    storage,
    namespace,
    runId,
    event,
  );
  return createWorkflowAppendProjectionPipelineFromStepAttemptPlan(
    storage,
    namespace,
    runId,
    event,
    initialStepAttemptPlan,
  );
}

function createWorkflowAppendProjectionPipelineFromStepAttemptPlan(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  initialStepAttemptPlan: WorkflowStepAttemptMaterializationStoragePlan | undefined,
): WorkflowAppendProjectionPipeline {
  return {
    materializesAtomically: initialStepAttemptPlan?.materializes === true,
    planAtomicProjections: createWorkflowAppendAtomicProjectionPlanner(
      storage,
      namespace,
      runId,
      event,
      initialStepAttemptPlan,
    ),
    async finalize(outcome) {
      return await projectMessageIdempotencyIndexForAppendOutcome(
        storage,
        namespace,
        runId,
        event,
        outcome,
      );
    },
    async finalizePostCommit(outcome) {
      if (!supportsWorkflowAtomicBatchWrite(storage)) {
        await materializeStepAttemptForAppendOutcome(storage, namespace, runId, event, outcome);
      }
    },
  };
}

function createWorkflowAppendAtomicProjectionPlanner(
  storage: WorkflowStorage,
  namespace: string,
  runId: RunId,
  event: EventRecord,
  initialStepAttemptPlan?: WorkflowStepAttemptMaterializationStoragePlan,
): WorkflowEventAppendAtomicProjectionPlanner | undefined {
  if (!supportsWorkflowAtomicBatchWrite(storage)) {
    return undefined;
  }
  return async (attempt) =>
    attempt === 0 && initialStepAttemptPlan !== undefined
      ? initialStepAttemptPlan
      : await createWorkflowStepAttemptMaterializationStoragePlan(storage, namespace, runId, event);
}
