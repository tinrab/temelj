import type { WorkflowErrorRecord } from "./error.ts";
import type { RunRecord } from "./run.ts";

export type ExecutionResultKind = "completed" | "waiting" | "failed";

/** Result returned after a workflow execution attempt completes, waits, or fails. */
export type ExecutionResult<TOutput = unknown> =
  | CompletedResult<TOutput>
  | WaitingResult
  | FailedResult;

/** Execution result for a workflow run that completed during the attempt. */
export interface CompletedResult<TOutput> {
  readonly kind: "completed";
  readonly run: RunRecord;
  readonly output: TOutput;
}

/** Execution result for a workflow run that parked until a later time or message. */
export interface WaitingResult {
  readonly kind: "waiting";
  readonly run: RunRecord;
  readonly availableAt: Temporal.Instant;
}

/** Execution result for a workflow run that failed during the attempt. */
export interface FailedResult {
  readonly kind: "failed";
  readonly run: RunRecord;
  readonly error: WorkflowErrorRecord;
}

/** Options for polling a client run handle until the run reaches a terminal result. */
export interface ResultOptions {
  readonly pollInterval?: Temporal.Duration;
  readonly timeout?: Temporal.Duration;
}
