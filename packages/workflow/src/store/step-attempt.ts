import type { RunId } from "../types/ids.ts";
import type { WorkflowPage } from "../types/pagination.ts";
import type { ListStepAttemptsPageOptions } from "../types/run-list.ts";
import type { ListStepAttemptsOptions, StepAttemptRecord } from "../types/step-attempts.ts";
import type { WorkflowStore, WorkflowStorage } from "../types/store.ts";

import { limitItems } from "../collection.ts";
import { makeStepAttemptCursorKey, pageItems } from "../pagination.ts";
import { reconcileStepAttempts } from "./materialization.ts";
import { getRequiredRun, queryStepAttempts } from "./query.ts";

export async function listWorkflowStepAttempts(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStore,
  runId: RunId,
  options?: ListStepAttemptsOptions,
): Promise<readonly StepAttemptRecord[]> {
  const attempts = await queryStepAttempts(storage, namespace, store, runId, options, {
    label: "Workflow step attempt list options",
  });

  return limitItems(attempts, options?.limit);
}

export async function listWorkflowStepAttemptsPage(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStore,
  runId: RunId,
  options?: ListStepAttemptsPageOptions,
): Promise<WorkflowPage<StepAttemptRecord>> {
  const attempts = await queryStepAttempts(
    storage,
    namespace,
    store,
    runId,
    { ...options, limit: undefined },
    { label: "Workflow step attempt page options" },
  );

  return pageItems(attempts, options, "Workflow step attempt page", makeStepAttemptCursorKey);
}

export async function countWorkflowStepAttempts(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStore,
  runId: RunId,
  options?: ListStepAttemptsOptions,
): Promise<number> {
  return (
    await queryStepAttempts(storage, namespace, store, runId, options, {
      label: "Workflow step attempt list options",
    })
  ).length;
}

export async function repairWorkflowStepAttempts(
  storage: WorkflowStorage,
  namespace: string,
  store: WorkflowStore,
  runId: RunId,
): Promise<readonly StepAttemptRecord[]> {
  await getRequiredRun(store, runId);

  return await reconcileStepAttempts(storage, namespace, runId, await store.getEvents(runId));
}
