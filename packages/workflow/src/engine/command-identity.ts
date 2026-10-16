import type { History } from "../history/replay.ts";
import type { StepIdentity, StepType } from "../types/run.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowOptionsError } from "../errors/mod.ts";

/** Resolves the durable identity for a workflow command occurrence. */
export function resolveCommandIdentity<TType extends StepType>(
  history: History,
  kind: TType,
  commandId: string,
): StepIdentity<TType> {
  return history.nextStep(kind, commandId);
}

/** Resolves a durable command identity from ordered command-name candidates. */
export function resolveCommandIdentityFromCandidates<TType extends StepType>(
  history: History,
  kind: TType,
  candidates: readonly (string | undefined)[],
  label: string,
): StepIdentity<TType> {
  for (const candidate of candidates) {
    if (candidate !== undefined) {
      return resolveCommandIdentity(history, kind, candidate);
    }
  }

  throw new WorkflowOptionsError(`${label} is required`, {
    code: WorkflowErrorCode.OPTIONS_REQUIRED,
    details: { label },
  });
}
