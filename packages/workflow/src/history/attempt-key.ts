import type { StepId } from "../types/step-id.ts";

/** Builds the stable key used to identify a materialized workflow step attempt. */
export function makeWorkflowStepAttemptKey(stepId: StepId, attempt: number): string {
  return `run:${stepId}:${attempt}`;
}
