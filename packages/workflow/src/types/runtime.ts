import type { Logger } from "@temelj/log";

import { z } from "zod";

import type {
  CompiledWorkflowFunction,
  WorkflowClientWorkersApi,
  WorkflowRunHandle,
} from "./client.ts";
import type {
  WorkflowDefinition,
  WorkflowHandler,
  WorkflowImplementation,
  RegistryLike,
  WorkflowStartTarget,
} from "./definition.ts";
import type {
  WorkflowDeterministicBytesContext,
  WorkflowDeterministicValueContext,
  WorkflowExecutionLimits,
  WorkflowRecordedIdContext,
} from "./engine-options.ts";
import type { WorkflowClientEngine, WorkflowWorkerEngine } from "./engine.ts";
import type {
  AcquireLockOptions,
  LockRecord,
  ReleaseLockOptions,
  ReleaseStaleLockOptions,
} from "./lock.ts";
import type { WorkflowPage } from "./pagination.ts";
import type { WorkflowListRunsOptions } from "./run-list.ts";
import type {
  WorkflowRunArguments,
  ScheduleNextOptions,
  WorkflowStartOptions,
} from "./run-options.ts";
import type { WorkflowLifecycleCallback, RunId, WorkflowRunRecord } from "./run.ts";
import type {
  ScheduleId,
  ListSchedulesOptions,
  ListSchedulesPageOptions,
  ScheduleConfig,
  ScheduleRecord,
  TickSchedulesOptions,
  TickSchedulesResult,
} from "./schedule.ts";
import type { Telemetry } from "./telemetry.ts";

import { WorkflowRuntimeError } from "../errors/runtime.ts";

const workflowRuntimeObjectPropertySchema = z.object({});
const workflowRuntimeFunctionPropertySchema = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === "function",
);

export const workflowRuntimeSchema = z.object({
  runs: workflowRuntimeObjectPropertySchema,
  schedules: workflowRuntimeObjectPropertySchema,
  locks: workflowRuntimeObjectPropertySchema,
  workers: workflowRuntimeObjectPropertySchema,
  close: workflowRuntimeFunctionPropertySchema,
  implementWorkflow: workflowRuntimeFunctionPropertySchema,
  register: workflowRuntimeFunctionPropertySchema,
  start: workflowRuntimeFunctionPropertySchema,
});

/** Asserts that a value has the minimum shape required by runtime helper functions. */
export function parseWorkflowRuntime(value: unknown): asserts value is WorkflowRuntime {
  const parsed = workflowRuntimeSchema.safeParse(value);
  if (!parsed.success) {
    WorkflowRuntimeError.invalid();
  }
}

/** Options for workflow creation runtime. */
export interface CreateWorkflowRuntimeOptions extends WorkflowExecutionLimits {
  readonly engine?: WorkflowClientEngine;
  readonly workerEngine?: WorkflowWorkerEngine;
  readonly registry?: RegistryLike;
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

/** Describes the workflow runtime contract. */
export interface WorkflowRuntime {
  /** Grouped run handle and run listing operations. */
  readonly runs: WorkflowRuntimeRunsApi;
  /** Grouped schedule management operations. */
  readonly schedules: WorkflowRuntimeSchedulesApi;
  /** Grouped workflow lock operations. */
  readonly locks: WorkflowRuntimeLocksApi;
  /** Grouped worker operations. */
  readonly workers: WorkflowClientWorkersApi;
  /** Flushes resources owned by this runtime. */
  close(): Promise<void>;
  /** Creates and registers a workflow implementation. */
  implementWorkflow<TInput, TOutput, TRawInput = TInput>(
    definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
    handler: WorkflowHandler<TInput, TOutput>,
  ): WorkflowImplementation<TInput, TOutput, TRawInput>;
  /** Registers an existing workflow implementation. */
  register<TInput, TOutput, TRawInput = TInput>(
    implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  ): void;
  /** Starts a registered workflow definition. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowDefinition<TInput, TOutput, TRawInput>,
    ...args: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  /** Registers and starts a workflow implementation. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowImplementation<TInput, TOutput, TRawInput>,
    ...args: WorkflowRunArguments<TRawInput, WorkflowStartOptions>
  ): Promise<WorkflowRunHandle<TOutput>>;
  /** Starts a compiled workflow function produced by the workflow transform. */
  start<TArgs extends readonly unknown[], TOutput>(
    workflow: CompiledWorkflowFunction<TArgs, TOutput>,
    ...args: TArgs
  ): Promise<WorkflowRunHandle<Awaited<TOutput>>>;
}

/** Describes runtime-level run operations. */
export interface WorkflowRuntimeRunsApi {
  /** Returns a typed handle for an existing run. */
  getHandle<TOutput = unknown>(runId: RunId): Promise<WorkflowRunHandle<TOutput>>;
  /** Lists workflow runs visible to the runtime client. */
  list(options?: WorkflowListRunsOptions): Promise<readonly WorkflowRunRecord[]>;
}

/** Describes runtime-level schedule operations. */
export interface WorkflowRuntimeSchedulesApi {
  /** Schedules one workflow run at the next interval boundary. */
  next<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    input: TRawInput,
    options: ScheduleNextOptions,
  ): Promise<WorkflowRunHandle<TOutput>>;
  /** Creates a recurring workflow schedule. */
  create<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    options: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord<TInput>>;
  /** Creates or updates a recurring workflow schedule. */
  upsert<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
    options: ScheduleConfig<TInput, TRawInput>,
  ): Promise<ScheduleRecord<TInput>>;
  /** Returns a schedule by ID, if it exists. */
  get(scheduleId: ScheduleId): Promise<ScheduleRecord | undefined>;
  /** Lists schedules matching optional filters. */
  list(options?: ListSchedulesOptions): Promise<readonly ScheduleRecord[]>;
  /** Lists one page of schedules matching optional filters. */
  page(options?: ListSchedulesPageOptions): Promise<WorkflowPage<ScheduleRecord>>;
  /** Pauses an active schedule. */
  pause(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Resumes a paused or archived schedule. */
  resume(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Archives a schedule without deleting its record. */
  archive(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Marks a schedule as deleted. */
  delete(scheduleId: ScheduleId): Promise<ScheduleRecord>;
  /** Starts runs for schedules that are due. */
  tick(options?: TickSchedulesOptions): Promise<TickSchedulesResult>;
}

/** Describes runtime-level workflow lock operations. */
export interface WorkflowRuntimeLocksApi {
  /** Acquires a workflow lock. */
  acquire(key: string, options: AcquireLockOptions): Promise<LockRecord>;
  /** Returns a workflow lock by key, if it exists. */
  get(key: string): Promise<LockRecord | undefined>;
  /** Lists workflow locks. */
  list(): Promise<readonly LockRecord[]>;
  /** Releases a workflow lock held by the supplied holder. */
  release(key: string, options: ReleaseLockOptions): Promise<LockRecord>;
  /** Releases a workflow lock only when its lease is stale. */
  releaseStale(key: string, options?: ReleaseStaleLockOptions): Promise<LockRecord>;
}
