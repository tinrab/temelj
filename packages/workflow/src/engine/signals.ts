import type { RunId } from "../types/ids.ts";
import type { StepIdentity } from "../types/run.ts";

// Signals unwind a workflow body back to the engine. They are never reported to callers.

/** Stops execution until `availableAt`, such as for a sleep, a message wait, or a step retry. */
export class Suspended extends Error {
  public readonly availableAt: Temporal.Instant;
  public readonly retryAt?: Temporal.Instant;
  public readonly retryReason?: "step";
  public readonly retryAttempt?: number;
  public readonly retryStep?: StepIdentity;

  constructor(
    availableAt: Temporal.Instant,
    retry?: { readonly step: StepIdentity; readonly attempt: number },
  ) {
    super(`Workflow suspended until ${availableAt.toString()}`);
    this.name = "WorkflowSuspended";
    this.availableAt = availableAt;

    if (retry !== undefined) {
      this.retryAt = availableAt;
      this.retryReason = "step";
      this.retryAttempt = retry.attempt;
      this.retryStep = retry.step;
    }
  }

  static until(this: void, availableAt: Temporal.Instant): never {
    throw new Suspended(availableAt);
  }

  static forStepRetry(
    this: void,
    retryAt: Temporal.Instant,
    step: StepIdentity,
    attempt: number,
  ): never {
    throw new Suspended(retryAt, { step, attempt });
  }
}

/** Stops an execution that lost ownership of its run, such as after its lease was reclaimed. */
export class StaleExecutionError extends Error {
  constructor(runId: RunId) {
    super(`Workflow execution no longer owns run: ${runId}`);
    this.name = "WorkflowStaleExecutionError";
  }

  static stale(this: void, runId: RunId): never {
    throw new StaleExecutionError(runId);
  }
}
