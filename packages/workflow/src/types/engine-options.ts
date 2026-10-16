import type { Logger } from "@temelj/log";

import type { RunId } from "./ids.ts";
import type { WorkflowLifecycleCallback } from "./run.ts";
import type { WorkflowStorage, WorkflowStore } from "./store.ts";
import type { Telemetry } from "./telemetry.ts";

/** Options for creating the storage-backed workflow engine. */
export interface CreateWorkflowEngineOptions extends ExecutionLimits {
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
  readonly createRecordedId?: (context: RecordedIdContext) => string;
  /**
   * Creates the first value recorded by deterministic random commands.
   *
   * Hosts that patch `Math.random()` during workflow execution should route
   * patched calls through the same durable recording path.
   */
  readonly createDeterministicRandom?: (context: RecordedIdContext) => number;
  /**
   * Creates the first value recorded by deterministic UUID commands.
   *
   * Hosts that patch `crypto.randomUUID()` during workflow execution should
   * route patched calls through the same durable recording path.
   */
  readonly createDeterministicUuid?: (context: RecordedIdContext) => string;
  /**
   * Creates the first value recorded by deterministic byte commands.
   *
   * Hosts that patch `crypto.getRandomValues()` during workflow execution
   * should route patched calls through the same durable recording path.
   */
  readonly createDeterministicBytes?: (context: DeterministicBytesContext) => Uint8Array;
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
export interface ExecutionLimits {
  readonly maximumPersistedValueBytes?: number;
  readonly maximumEventHistoryEvents?: number;
  readonly maximumStreamChunks?: number;
}

/** Context passed to custom deterministic ID generators. */
export interface RecordedIdContext {
  readonly runId: RunId;
  readonly commandId: string;
  readonly commandName: string;
  readonly commandCount: number;
}

/** Context passed to custom deterministic byte generators. */
export interface DeterministicBytesContext extends RecordedIdContext {
  readonly length: number;
}
