import type { WorkflowHistory } from "../history/mod.ts";
import type { WorkflowStepIdentity, WorkflowStepType } from "../types/run.ts";

import { WorkflowOptionsError } from "../errors/mod.ts";

/** Resolves the durable identity for a workflow command occurrence. */
export function resolveWorkflowCommandIdentity<TType extends WorkflowStepType>(
  history: WorkflowHistory,
  kind: TType,
  commandId: string,
): WorkflowStepIdentity<TType> {
  return history.nextStep(kind, commandId);
}

/** Resolves a durable command identity from ordered command-name candidates. */
export function resolveWorkflowCommandIdentityFromCandidates<TType extends WorkflowStepType>(
  history: WorkflowHistory,
  kind: TType,
  candidates: readonly (string | undefined)[],
  label: string,
): WorkflowStepIdentity<TType> {
  for (const candidate of candidates) {
    if (candidate !== undefined) {
      return resolveWorkflowCommandIdentity(history, kind, candidate);
    }
  }
  throw WorkflowOptionsError.required(label);
}
