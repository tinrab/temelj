import type { StorageValue } from "@temelj/storage";

import type { WorkflowErrorRecord } from "./error.ts";
import type { EventRecord } from "./events.ts";
import type { RunId, WorkflowAttributePatch, WorkflowRunRecord, WorkflowRunStatus } from "./run.ts";
import type { Timeline } from "./timeline.ts";

/** Kind values for workflow execution results. */
export type ExecutionResultKind = "completed" | "waiting" | "failed";

/** Base contract for workflow execution results. */
export interface ExecutionResultBase {
  readonly kind: ExecutionResultKind;
  readonly run: WorkflowRunRecord;
}

/** Result returned after a workflow execution attempt completes, waits, or fails. */
export type ExecutionResult<TOutput = unknown> =
  | CompletedResult<TOutput>
  | WaitingResult
  | FailedResult;

/** Execution result for a workflow run that completed during the attempt. */
export interface CompletedResult<TOutput> {
  readonly kind: "completed";
  readonly run: WorkflowRunRecord<StorageValue, TOutput>;
  readonly output: TOutput;
}

/** Execution result for a workflow run that parked until a later time or message. */
export interface WaitingResult {
  readonly kind: "waiting";
  readonly run: WorkflowRunRecord;
  readonly availableAt: Temporal.Instant;
}

/** Execution result for a workflow run that failed during the attempt. */
export interface FailedResult {
  readonly kind: "failed";
  readonly run: WorkflowRunRecord;
  readonly error: WorkflowErrorRecord;
}

/** Engine-level handle for inspecting and controlling a workflow run. */
export interface WorkflowHandle<TOutput = unknown> {
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  getRun(): Promise<WorkflowRunRecord>;
  status(): Promise<WorkflowRunStatus>;
  events(): Promise<readonly EventRecord[]>;
  timeline(): Promise<Timeline>;
  result(): Promise<ExecutionResult<TOutput>>;
  setMetadata(metadata: unknown): Promise<WorkflowRunRecord>;
  setAttributes(attributes: WorkflowAttributePatch): Promise<WorkflowRunRecord>;
  cancel(): Promise<WorkflowRunRecord>;
}

/** Operations backing a workflow run handle facade. */
export interface HandleOperations {
  getTimeline(runId: RunId): Promise<Timeline>;
  setMetadata(runId: RunId, metadata: unknown): Promise<WorkflowRunRecord>;
  setAttributes(runId: RunId, attributes: WorkflowAttributePatch): Promise<WorkflowRunRecord>;
  cancel(runId: RunId): Promise<WorkflowRunRecord>;
}

/** Options for polling a client run handle until the run reaches a terminal result. */
export interface ResultOptions {
  readonly pollInterval?: Temporal.Duration;
  readonly timeout?: Temporal.Duration;
}
