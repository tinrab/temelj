import type { WorkflowPage } from "../types/pagination.ts";
import type { WorkflowListStepAttemptsPageOptions } from "../types/run-list.ts";
import type { RunId } from "../types/run.ts";
import type {
  WorkflowListStepAttemptsOptions,
  WorkflowStepAttemptRecord,
} from "../types/step-attempts.ts";
import type {
  WorkflowEventReader,
  WorkflowRunReaderRepository,
  WorkflowStorage,
} from "../types/store.ts";

import { makeWorkflowStepAttemptCursorKey, pageItems } from "../pagination.ts";
import { limitWorkflowItems } from "../utility.ts";
import { reconcileStepAttempts } from "./materialization.ts";
import { getRequiredStoreRun, queryWorkflowStepAttempts } from "./query.ts";

type WorkflowStepAttemptReadStore = WorkflowRunReaderRepository & WorkflowEventReader;

export async function listWorkflowStepAttempts(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStepAttemptReadStore,
  runId: RunId,
  options?: WorkflowListStepAttemptsOptions,
): Promise<readonly WorkflowStepAttemptRecord[]> {
  const attempts = await queryWorkflowStepAttempts(storage, namespace, store, runId, options, {
    label: "Workflow step attempt list options",
  });
  return limitWorkflowItems(attempts, options?.limit);
}

export async function listWorkflowStepAttemptsPage(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStepAttemptReadStore,
  runId: RunId,
  options?: WorkflowListStepAttemptsPageOptions,
): Promise<WorkflowPage<WorkflowStepAttemptRecord>> {
  const attempts = await queryWorkflowStepAttempts(
    storage,
    namespace,
    store,
    runId,
    { ...options, limit: undefined },
    { label: "Workflow step attempt page options" },
  );
  return pageItems(
    attempts,
    options,
    "Workflow step attempt page",
    makeWorkflowStepAttemptCursorKey,
  );
}

export async function countWorkflowStepAttempts(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStepAttemptReadStore,
  runId: RunId,
  options?: WorkflowListStepAttemptsOptions,
): Promise<number> {
  return (
    await queryWorkflowStepAttempts(storage, namespace, store, runId, options, {
      label: "Workflow step attempt list options",
    })
  ).length;
}

export async function repairWorkflowStepAttempts(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStepAttemptReadStore,
  runId: RunId,
): Promise<readonly WorkflowStepAttemptRecord[]> {
  await getRequiredStoreRun(store, runId);
  return await reconcileStepAttempts(storage, namespace, runId, await store.getEvents(runId));
}
