import type { Logger } from "@temelj/log";

import type { WorkflowLifecycleCallback, RunId } from "./run.ts";
import type { WorkflowStorage, WorkflowStore } from "./store.ts";
import type { Telemetry } from "./telemetry.ts";

/** Options for creating the storage-backed workflow engine. */
export interface CreateWorkflowEngineOptions extends WorkflowExecutionLimits {
  readonly storage?: WorkflowStorage;
  readonly store?: WorkflowStore;
  /**
   * Clock used for workflow timestamps and the first value recorded by
   * deterministic time commands.
   *
   * Hosts that patch `Date.now()` during workflow execution should route
   * patched calls through the same durable recording path.
   */
  readonly now?: () => Temporal.Instant;
  readonly createRunId?: () => string;
  readonly createRecordedId?: (context: WorkflowRecordedIdContext) => string;
  /**
   * Creates the first value recorded by deterministic random commands.
   *
   * Hosts that patch `Math.random()` during workflow execution should route
   * patched calls through the same durable recording path.
   */
  readonly createDeterministicRandom?: (context: WorkflowDeterministicValueContext) => number;
  /**
   * Creates the first value recorded by deterministic UUID commands.
   *
   * Hosts that patch `crypto.randomUUID()` during workflow execution should
   * route patched calls through the same durable recording path.
   */
  readonly createDeterministicUuid?: (context: WorkflowDeterministicValueContext) => string;
  /**
   * Creates the first value recorded by deterministic byte commands.
   *
   * Hosts that patch `crypto.getRandomValues()` during workflow execution
   * should route patched calls through the same durable recording path.
   */
  readonly createDeterministicBytes?: (context: WorkflowDeterministicBytesContext) => Uint8Array;
  readonly onLifecycleEvent?: WorkflowLifecycleCallback;
  readonly onRunCompleted?: WorkflowLifecycleCallback;
  readonly onRunFailed?: WorkflowLifecycleCallback;
  readonly onRunCanceled?: WorkflowLifecycleCallback;
  readonly onRunWaiting?: WorkflowLifecycleCallback;
  readonly onRunRetry?: WorkflowLifecycleCallback;
  readonly maximumStepAttemptsPerRun?: number;
  readonly telemetry?: Telemetry | false;
  readonly logger?: Logger | false;
}

/** Runtime limits applied while executing workflows. */
export interface WorkflowExecutionLimits {
  readonly maximumPersistedValueBytes?: number;
  readonly maximumEventHistoryEvents?: number;
  readonly maximumStreamChunks?: number;
}

/** Runtime limits that affect persisted value serialization. */
export interface WorkflowEngineSerializationLimits {
  readonly maximumPersistedValueBytes?: number;
}

/** Context passed to custom deterministic ID generators. */
export interface WorkflowRecordedIdContext {
  readonly runId: RunId;
  readonly commandId: string;
  readonly commandName: string;
  readonly commandCount: number;
}

/** Context passed to custom deterministic first-run value generators. */
export type WorkflowDeterministicValueContext = WorkflowRecordedIdContext;

/** Context passed to custom deterministic byte generators. */
export interface WorkflowDeterministicBytesContext extends WorkflowDeterministicValueContext {
  readonly length: number;
}
