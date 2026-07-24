import { z } from "zod";

import type { ObservationEventMap } from "./observation.ts";
import type { ExecutionResult } from "./result.ts";
import type { WorkflowResolvedStepRetryConfig } from "./retry.ts";
import type { WorkflowRunRecord } from "./run.ts";
import type { WorkflowStepMetadata } from "./step.ts";
import type { WorkflowRunSummary, WorkflowRunSummaryOptions } from "./summary.ts";

import { nonBlankStringSchema } from "./common.ts";

export const workflowTelemetryContextSchema = z.object({
  traceparent: nonBlankStringSchema.optional(),
  tracestate: nonBlankStringSchema.optional(),
});

/** Persisted W3C trace context captured when a workflow run is created. */
export interface TelemetryContext {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

/** Context passed to telemetry adapters around workflow run execution. */
export interface RunTelemetryContext {
  readonly run: WorkflowRunRecord;
  readonly traceContext?: TelemetryContext;
}

/** Context passed to telemetry adapters after workflow run execution finishes. */
export interface RunTelemetryResultContext<TOutput = unknown> extends RunTelemetryContext {
  readonly result?: ExecutionResult<TOutput>;
  readonly error?: unknown;
}

/** Context passed to telemetry adapters around durable task callback execution. */
export interface StepTelemetryContext {
  readonly run: WorkflowRunRecord;
  readonly step: WorkflowStepMetadata;
  readonly attempt: number;
  readonly retry: WorkflowResolvedStepRetryConfig;
  readonly timeoutAt?: Temporal.Instant;
}

/** Context passed to telemetry adapters after durable task callback execution finishes. */
export interface StepTelemetryResultContext extends StepTelemetryContext {
  readonly error?: unknown;
}

/** Storage/backend operation names observed by the default workflow store. */
export type StorageTelemetryOperation =
  | "get"
  | "tryGet"
  | "set"
  | "trySet"
  | "compareAndSet"
  | "tryCompareAndSet"
  | "compareAndSetMany"
  | "tryCompareAndSetMany"
  | "has"
  | "tryHas"
  | "delete"
  | "tryDelete"
  | "getMany"
  | "tryGetMany"
  | "setMany"
  | "trySetMany"
  | "deleteMany"
  | "tryDeleteMany"
  | "keys"
  | "tryKeys"
  | "entries"
  | "tryEntries"
  | "clear"
  | "tryClear"
  | "watch"
  | "unwatch"
  | "dispose"
  | "tryDispose";

/** Context passed to telemetry adapters around workflow storage/backend operations. */
export interface StorageTelemetryContext {
  readonly operation: StorageTelemetryOperation;
  readonly backend: string;
}

/** Minimal engine read model exposed to telemetry adapters after engine creation. */
export interface TelemetryEngine {
  /** Returns aggregate run metrics for runs matching optional filters. */
  getRunSummary(options?: WorkflowRunSummaryOptions): Promise<WorkflowRunSummary>;
}

/** Optional telemetry hooks used to observe running workflow behavior. */
export interface Telemetry {
  /** Captures ambient trace context for a newly-created workflow run. */
  captureContext?(): TelemetryContext | undefined;
  /** Runs a workflow execution callback with telemetry context. */
  withRunExecution?<T>(context: RunTelemetryContext, callback: () => Promise<T>): Promise<T>;
  /** Runs a durable task callback with telemetry context. */
  withStepExecution?<T>(context: StepTelemetryContext, callback: () => Promise<T>): Promise<T>;
  /** Runs a workflow storage/backend operation callback with telemetry context. */
  withStorageOperation?<T>(
    context: StorageTelemetryContext,
    callback: () => Promise<T>,
  ): Promise<T>;
  /** Observes the final outcome of a workflow execution callback. */
  recordRunExecution?<TOutput>(context: RunTelemetryResultContext<TOutput>): void;
  /** Observes the final outcome of a durable task callback. */
  recordStepExecution?(context: StepTelemetryResultContext): void;
  /** Observes committed workflow observation events. */
  observe?<Key extends keyof ObservationEventMap>(
    name: Key,
    payload: ObservationEventMap[Key],
  ): void;
  /** Binds the telemetry adapter to an engine after engine creation. */
  bindEngine?(engine: TelemetryEngine): void;
  /** Releases telemetry resources owned by the adapter. */
  shutdown?(): Promise<void> | void;
}
