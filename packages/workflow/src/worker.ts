import "temporal-polyfill/global";
import type { RegistryLike } from "./types/definition.ts";
import type { WorkflowWorkerEngine, WorkflowWorkerEngineStore } from "./types/engine.ts";
import type { WorkflowErrorRecord } from "./types/error.ts";
import type { ExecutionResult } from "./types/result.ts";
import type { WorkflowResolvedMissingImplementationRetryConfig } from "./types/retry.ts";
import type { RunId, WorkflowRunRecord } from "./types/run.ts";
import type { WorkflowRunSummary } from "./types/summary.ts";
import type {
  CreateWorkflowWorkerOptions,
  WorkflowWorker as WorkflowWorkerContract,
  WorkflowWorkerLeaseOptions,
  WorkflowWorkerRunFilterOptions,
  WorkflowWorkerRunOptions,
  WorkflowWorkerRunResult,
} from "./types/worker.ts";

import { resolveMissingImplementationRetryConfig } from "./engine/retry.ts";
import {
  transitionRunToFailed,
  transitionRunToMissingImplementationWait,
  patchRunIfCurrent,
  wakeParentRunForWaitingChild,
  wakeParentRunForTerminalChild as wakeParentRunForTerminalChildState,
} from "./engine/state.ts";
import { WorkflowStateError } from "./errors/base.ts";
import { WorkflowCapabilityError } from "./errors/capability.ts";
import { WorkflowRunNotFoundError } from "./errors/run.ts";
import { requireWorkflowStoreCapabilities } from "./store/capabilities.ts";
import { durationBetween } from "./temporal.ts";
import {
  MAX_TIMER_DELAY,
  type IntervalHandle,
  nonNegativeTimerDelay,
  positiveTimerDelay,
  type TimeoutHandle,
} from "./timer.ts";
import {
  createDefaultWorkerId,
  isPositiveSafeInteger,
  resolvePositiveSafeIntegerOption,
} from "./utility.ts";
import {
  DEFAULT_MISSING_IMPLEMENTATION_RETRY_INTERVAL,
  makeMissingImplementationDeadlineErrorRecord,
  makeMissingImplementationNotFoundErrorRecord,
  missingImplementationRetryDelay,
  toWorkflowWorkerErrorRecord,
} from "./worker/error.ts";

const DEFAULT_WORKER_LEASE_DURATION = Temporal.Duration.from({ seconds: 30 });
const DEFAULT_WORKER_POLL_INTERVAL = Temporal.Duration.from({ milliseconds: 100 });
const DEFAULT_WORKER_STOP_DRAIN_TIMEOUT = Temporal.Duration.from({ seconds: 30 });

interface WorkerRunSlotResult {
  readonly execution: Promise<WorkerRunSlotResult>;
  readonly result?: ExecutionResult<unknown>;
  readonly error?: unknown;
}

interface WorkflowWorkerClaimOptions extends WorkflowWorkerRunFilterOptions {
  readonly runId?: string;
}

interface WorkflowWorkerLocalObservationEvent {
  readonly runId?: RunId;
  readonly operation: "poll" | "claim" | "heartbeat" | "lease_extension" | "lease_release";
  readonly status: "success" | "failure" | "claimed" | "empty";
  readonly timestamp: Temporal.Instant;
  readonly run?: WorkflowRunRecord;
  readonly error?: unknown;
}

/** Storage-backed workflow worker implementation. */
export class WorkflowWorker implements WorkflowWorkerContract {
  readonly #engine: WorkflowWorkerEngine;
  readonly #store: WorkflowWorkerEngineStore;
  readonly #registry: RegistryLike;
  readonly #workerId: string;
  readonly #leaseDuration: Temporal.Duration;
  readonly #heartbeatInterval: number;
  readonly #stopDrainTimeout: number;
  readonly #defaultPollInterval: number;
  readonly #missingImplementationRetry: WorkflowResolvedMissingImplementationRetryConfig;
  readonly #now: () => Temporal.Instant;
  #stopRequested = false;
  readonly #pollWakeups = new Set<() => void>();
  readonly #activeExecutionAborts = new Set<AbortController>();
  readonly #activeExecutions = new Set<Promise<unknown>>();
  readonly #activeExecutionRuns = new Map<string, number>();

  constructor(options: CreateWorkflowWorkerOptions) {
    const store = options.engine.store;

    requireWorkflowStoreCapabilities(store, {
      conditionalRunClaims: "workflow worker conditional run claims",
      conditionalRunUpdates: "workflow worker conditional run updates",
      conditionalRunLeaseExtensions: "workflow worker conditional lease extensions",
      conditionalRunLeaseReleases: "workflow worker conditional lease releases",
      conditionalEventAppends: "workflow worker conditional event appends",
      reconcilesStepAttemptsFromEvents: "workflow worker step-attempt reconciliation",
    });

    this.#engine = options.engine;
    this.#store = store;
    this.#registry = options.registry;
    this.#workerId = options.workerId ?? createDefaultWorkerId();
    this.#leaseDuration = options.leaseDuration ?? DEFAULT_WORKER_LEASE_DURATION;
    const resolvedLeaseDelay = positiveTimerDelay(
      this.#leaseDuration,
      "Workflow worker leaseDuration",
    );
    this.#heartbeatInterval =
      options.heartbeatInterval === undefined
        ? Math.min(MAX_TIMER_DELAY, Math.max(1, Math.floor(resolvedLeaseDelay.clampedDelay / 2)))
        : nonNegativeTimerDelay(options.heartbeatInterval, "Workflow worker heartbeatInterval")
            .clampedDelay;
    this.#stopDrainTimeout = nonNegativeTimerDelay(
      options.stopDrainTimeout ?? DEFAULT_WORKER_STOP_DRAIN_TIMEOUT,
      "Workflow worker stopDrainTimeout",
    ).clampedDelay;
    this.#defaultPollInterval = nonNegativeTimerDelay(
      options.pollInterval ?? DEFAULT_WORKER_POLL_INTERVAL,
      "Workflow worker pollInterval",
    ).clampedDelay;
    this.#missingImplementationRetry = resolveMissingImplementationRetryConfig(
      options.missingImplementationRetry,
      {
        initialInterval: DEFAULT_MISSING_IMPLEMENTATION_RETRY_INTERVAL,
        backoffCoefficient: 2,
        maximumAttempts: 0,
      },
      "Workflow missing implementation retry options",
    );
    this.#now = options.now ?? Temporal.Now.instant;
  }

  async processRun(runId: RunId): Promise<ExecutionResult<unknown>> {
    this.#stopRequested = false;
    const run = await this.#claimRun({ runId });
    if (run === undefined) {
      WorkflowStateError.runNotClaimable(runId);
    }
    if (this.#stopRequested) {
      await this.#releaseLease(run.id, run.attempts);
      WorkflowStateError.workerStoppedBeforeRun(runId);
    }
    return await this.#executeClaimedRun(run);
  }

  async processNextRun(
    options?: WorkflowWorkerRunFilterOptions,
  ): Promise<ExecutionResult<unknown> | undefined> {
    this.#stopRequested = false;
    return await this.#processNextRun(options);
  }

  async extendLease(
    runId: RunId,
    options?: WorkflowWorkerLeaseOptions,
  ): Promise<WorkflowRunRecord | undefined> {
    return await this.#extendLease(runId, options?.attempts);
  }

  async releaseLease(
    runId: RunId,
    options?: WorkflowWorkerLeaseOptions,
  ): Promise<WorkflowRunRecord | undefined> {
    return await this.#releaseLease(runId, options?.attempts);
  }

  async run(options?: WorkflowWorkerRunOptions): Promise<WorkflowWorkerRunResult> {
    this.#stopRequested = false;
    let processedRuns = 0;
    const activeRuns = new Set<Promise<WorkerRunSlotResult>>();
    const pollInterval =
      options?.pollInterval === undefined
        ? this.#defaultPollInterval
        : nonNegativeTimerDelay(options.pollInterval, "Workflow worker pollInterval").clampedDelay;
    const maxRuns = resolvePositiveSafeIntegerOption(options?.maxRuns, "Workflow worker maxRuns");
    const concurrency =
      resolvePositiveSafeIntegerOption(options?.concurrency, "Workflow worker concurrency") ?? 1;
    const tickSchedules = options?.tickSchedules ?? false;

    while (!this.#stopRequested && options?.signal?.aborted !== true) {
      if (maxRuns !== undefined && processedRuns >= maxRuns) {
        break;
      }

      if (tickSchedules) {
        await this.#tickDueSchedules();
      }

      while (
        !this.#stopRequested &&
        activeRuns.size < concurrency &&
        (maxRuns === undefined || processedRuns + activeRuns.size < maxRuns)
      ) {
        let execution: Promise<WorkerRunSlotResult>;
        execution = this.#processNextRun(options ?? {}, options?.signal).then(
          (result): WorkerRunSlotResult => ({ execution, result }),
          (error: unknown): WorkerRunSlotResult => ({ error, execution }),
        );
        activeRuns.add(execution);
      }

      if (activeRuns.size > 0) {
        const settled = await Promise.race(activeRuns);
        activeRuns.delete(settled.execution);
        if (settled.error !== undefined) {
          await this.#abortActiveWorkerExecutions(activeRuns);
          throw settled.error;
        }
        if (settled.result !== undefined) {
          processedRuns++;
          continue;
        }
        if (activeRuns.size > 0) {
          await this.#sleep(
            await this.#idlePollDelay(options ?? {}, pollInterval, tickSchedules),
            options?.signal,
          );
          continue;
        }
      }

      if (this.#stopRequested || options?.signal?.aborted) {
        break;
      }

      await this.#sleep(
        await this.#idlePollDelay(options ?? {}, pollInterval, tickSchedules),
        options?.signal,
      );
    }

    if (activeRuns.size > 0) {
      for (const settled of await Promise.all(activeRuns)) {
        activeRuns.delete(settled.execution);
        if (settled.error !== undefined) {
          throw settled.error;
        }
        if (settled.result !== undefined) {
          processedRuns++;
        }
      }
    }

    return { processedRuns };
  }

  async stop(): Promise<void> {
    this.#stopRequested = true;
    const activeExecutions = [...this.#activeExecutions];
    const releaseRuns = [...this.#activeExecutionRuns];
    for (const controller of this.#activeExecutionAborts) {
      controller.abort();
    }
    for (const wakeup of this.#pollWakeups) {
      wakeup();
    }
    const drained = await this.#waitForActiveExecutions(activeExecutions);
    if (!drained) {
      return;
    }
    await Promise.all(
      releaseRuns.map(async ([runId, attempts]) => await this.#releaseLease(runId, attempts)),
    );
  }

  async #waitForActiveExecutions(activeExecutions: readonly Promise<unknown>[]): Promise<boolean> {
    if (activeExecutions.length === 0) {
      return true;
    }
    if (this.#stopDrainTimeout === 0) {
      return false;
    }
    let timer: TimeoutHandle | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, this.#stopDrainTimeout);
    });
    const drained = Promise.allSettled(activeExecutions).then(() => true);
    const result = await Promise.race([drained, timeout]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    return result;
  }

  async #abortActiveWorkerExecutions(activeRuns: Set<Promise<WorkerRunSlotResult>>): Promise<void> {
    for (const controller of this.#activeExecutionAborts) {
      controller.abort();
    }
    await Promise.all(activeRuns);
  }

  async #claimRun(options?: WorkflowWorkerClaimOptions): Promise<WorkflowRunRecord | undefined> {
    const timestamp = this.#now();
    const run = await this.#store.claimRun({
      ...options,
      workerId: this.#workerId,
      leaseDuration: this.#leaseDuration,
      now: timestamp,
    });
    if (run === undefined && options?.runId !== undefined) {
      this.#observeWorkerOperation({
        operation: "claim",
        status: "failure",
        timestamp,
        runId: options.runId,
      });
    }
    return run;
  }

  async #processNextRun(
    options?: WorkflowWorkerRunFilterOptions,
    signal?: AbortSignal,
  ): Promise<ExecutionResult<unknown> | undefined> {
    const timestamp = this.#now();
    const run = await this.#claimRun(options);
    this.#observeWorkerOperation({
      operation: "poll",
      status: run === undefined ? "empty" : "claimed",
      timestamp,
      ...(run === undefined ? {} : { runId: run.id, run }),
    });
    if (run === undefined) {
      return undefined;
    }
    if (this.#stopRequested || signal?.aborted === true) {
      await this.#releaseLease(run.id, run.attempts);
      return undefined;
    }
    return await this.#executeClaimedRun(run, signal);
  }

  async #tickDueSchedules(): Promise<void> {
    if (this.#engine.tickSchedules === undefined) {
      WorkflowCapabilityError.unsupported("workflow schedule ticking");
    }
    await this.#engine.tickSchedules({ now: this.#now() });
  }

  async #executeClaimedRun(
    run: WorkflowRunRecord,
    signal?: AbortSignal,
  ): Promise<ExecutionResult<unknown>> {
    const definition = this.#registry.getByName(run.workflowName, run.workflowVersion);
    if (definition === undefined) {
      return await this.#rescheduleMissingImplementation(run);
    }
    const attempts =
      run.attempts !== undefined && isPositiveSafeInteger(run.attempts) ? run.attempts : undefined;
    return await this.#withHeartbeat(
      run.id,
      attempts,
      signal,
      async (executionSignal) =>
        await this.#engine.resumeWorkflow(definition, run.id, { signal: executionSignal }),
    );
  }

  async #rescheduleMissingImplementation(
    run: WorkflowRunRecord,
  ): Promise<ExecutionResult<unknown>> {
    const timestamp = this.#now();
    const retryAttempt = run.attempts ?? (run.retryAttempt ?? 0) + 1;
    const errorRecord = makeMissingImplementationNotFoundErrorRecord(run);
    const deadlineAt = run.deadlineAt;
    if (deadlineAt !== undefined && Temporal.Instant.compare(deadlineAt, timestamp) <= 0) {
      return await this.#failMissingImplementationForDeadline(run, deadlineAt, timestamp);
    }
    if (
      this.#missingImplementationRetry.maximumAttempts > 0 &&
      retryAttempt >= this.#missingImplementationRetry.maximumAttempts
    ) {
      return await this.#failMissingImplementationRun(run, errorRecord, timestamp);
    }

    let availableAt: Temporal.Instant;
    try {
      availableAt = timestamp.add(
        Temporal.Duration.from({
          milliseconds: nonNegativeTimerDelay(
            missingImplementationRetryDelay(this.#missingImplementationRetry, retryAttempt),
            "Workflow missing implementation retry delay",
          ).clampedDelay,
        }),
      );
    } catch (retryError) {
      return await this.#failMissingImplementationRun(
        run,
        toWorkflowWorkerErrorRecord(retryError),
        timestamp,
      );
    }
    if (deadlineAt !== undefined && Temporal.Instant.compare(deadlineAt, availableAt) <= 0) {
      return await this.#failMissingImplementationForDeadline(run, deadlineAt, timestamp);
    }
    const waitingRun = await patchRunIfCurrent(
      this.#store,
      run,
      transitionRunToMissingImplementationWait(
        run,
        errorRecord,
        timestamp,
        availableAt,
        retryAttempt,
      ),
    );
    if (waitingRun === undefined) {
      return await this.#readRunExecutionResult(run.id);
    }
    await wakeParentRunForWaitingChild(this.#store, waitingRun, availableAt);

    return {
      kind: "waiting",
      run: waitingRun,
      availableAt,
    };
  }

  async #failMissingImplementationRun(
    run: WorkflowRunRecord,
    errorRecord: WorkflowErrorRecord,
    timestamp: Temporal.Instant,
  ): Promise<ExecutionResult<unknown>> {
    return await this.#failClaimedMissingImplementationRun(run, errorRecord, timestamp, "failed");
  }

  async #failMissingImplementationForDeadline(
    run: WorkflowRunRecord,
    deadlineAt: Temporal.Instant,
    timestamp: Temporal.Instant,
  ): Promise<ExecutionResult<unknown>> {
    return await this.#failClaimedMissingImplementationRun(
      run,
      makeMissingImplementationDeadlineErrorRecord(run, deadlineAt),
      timestamp,
      "deadline",
      deadlineAt,
    );
  }

  async #failClaimedMissingImplementationRun(
    run: WorkflowRunRecord,
    errorRecord: WorkflowErrorRecord,
    timestamp: Temporal.Instant,
    reason: "deadline" | "failed",
    deadlineAt?: Temporal.Instant,
  ): Promise<ExecutionResult<unknown>> {
    const failedRun = await patchRunIfCurrent(
      this.#store,
      run,
      transitionRunToFailed(run, errorRecord, timestamp, reason, deadlineAt),
    );
    if (failedRun === undefined) {
      return await this.#readRunExecutionResult(run.id);
    }
    const appendedEvents = await this.#store.appendEventIfRunCurrent(failedRun, {
      kind: "workflow_failed",
      timestamp,
    });
    if (appendedEvents === undefined) {
      return await this.#readRunExecutionResult(run.id);
    }
    await wakeParentRunForTerminalChildState(this.#store, failedRun, timestamp);

    return {
      kind: "failed",
      run: failedRun,
      error: errorRecord,
    };
  }

  async #readRunExecutionResult(runId: RunId): Promise<ExecutionResult<unknown>> {
    const current = await this.#engine.getRun(runId);
    if (current === undefined) {
      WorkflowRunNotFoundError.notFound(runId);
    }
    if (current.status === "completed") {
      return {
        kind: "completed",
        run: current,
        output: current.output,
      };
    }
    if (current.status === "failed") {
      return {
        kind: "failed",
        run: current,
        error: current.error ?? {
          name: "WorkflowError",
          message: `Workflow run failed: ${runId}`,
        },
      };
    }
    if (current.status === "canceled") {
      return {
        kind: "failed",
        run: current,
        error: current.error ?? {
          name: "WorkflowRunCanceledError",
          message: `Workflow run was canceled: ${runId}`,
        },
      };
    }
    return {
      kind: "waiting",
      run: current,
      availableAt: current.availableAt ?? this.#now(),
    };
  }

  async #extendLease(runId: RunId, attempts?: number): Promise<WorkflowRunRecord | undefined> {
    const timestamp = this.#now();
    const run = await this.#store.extendRunLease({
      runId,
      workerId: this.#workerId,
      attempts,
      leaseDuration: this.#leaseDuration,
      now: timestamp,
    });
    this.#observeWorkerOperation({
      operation: "lease_extension",
      status: run === undefined ? "failure" : "success",
      timestamp,
      runId,
      ...(run === undefined ? {} : { run }),
    });
    return run;
  }

  async #releaseLease(runId: RunId, attempts?: number): Promise<WorkflowRunRecord | undefined> {
    const timestamp = this.#now();
    const run = await this.#store.releaseRunLease({
      runId,
      workerId: this.#workerId,
      attempts,
      now: timestamp,
    });
    this.#observeWorkerOperation({
      operation: "lease_release",
      status: run === undefined ? "failure" : "success",
      timestamp,
      runId,
      ...(run === undefined ? {} : { run }),
    });
    return run;
  }

  async #withHeartbeat<T>(
    runId: RunId,
    attempts: number | undefined,
    signal: AbortSignal | undefined,
    callback: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const executionAbort = new AbortController();
    this.#activeExecutionAborts.add(executionAbort);
    if (attempts !== undefined) {
      this.#activeExecutionRuns.set(runId, attempts);
    }
    let timer: IntervalHandle | undefined;
    let heartbeatPending = false;
    let heartbeat: Promise<void> | undefined;
    let heartbeatError: unknown;
    let abortRelease: Promise<WorkflowRunRecord | undefined> | undefined;
    const abortExecution = () => {
      executionAbort.abort();
      abortRelease = this.#releaseLease(runId, attempts);
    };
    if (this.#stopRequested || signal?.aborted === true) {
      executionAbort.abort();
    } else {
      signal?.addEventListener("abort", abortExecution, { once: true });
    }

    if (this.#heartbeatInterval > 0) {
      timer = setInterval(() => {
        if (heartbeatPending || executionAbort.signal.aborted) {
          return;
        }
        // Only one heartbeat may be in flight. If lease extension fails because the run was
        // reclaimed or canceled, abort the user execution instead of letting stale code continue.
        heartbeatPending = true;
        heartbeat = this.#extendLease(runId, attempts)
          .then((run) => {
            if (run === undefined) {
              this.#observeWorkerOperation({
                operation: "heartbeat",
                status: "failure",
                timestamp: this.#now(),
                runId,
              });
              executionAbort.abort();
            }
          })
          .catch((error: unknown) => {
            executionAbort.abort();
            heartbeatError ??= error;
            this.#observeWorkerOperation({
              operation: "heartbeat",
              status: "failure",
              timestamp: this.#now(),
              runId,
              error,
            });
          })
          .finally(() => {
            heartbeatPending = false;
          });
      }, this.#heartbeatInterval);
    }

    const execution = (async () => await callback(executionAbort.signal))();
    this.#activeExecutions.add(execution);
    let executionOutcome:
      | { readonly status: "fulfilled"; readonly value: T }
      | { readonly status: "rejected"; readonly reason: unknown };
    try {
      executionOutcome = {
        status: "fulfilled",
        value: await execution,
      };
    } catch (error) {
      executionOutcome = {
        status: "rejected",
        reason: error,
      };
    } finally {
      if (timer !== undefined) {
        clearInterval(timer);
      }
      this.#activeExecutions.delete(execution);
      this.#activeExecutionAborts.delete(executionAbort);
      this.#activeExecutionRuns.delete(runId);
      signal?.removeEventListener("abort", abortExecution);
      await heartbeat;
      await abortRelease;
    }
    if (heartbeatError !== undefined) {
      throw heartbeatError;
    }
    if (executionOutcome.status === "rejected") {
      throw executionOutcome.reason;
    }
    return executionOutcome.value;
  }

  #observeWorkerOperation(event: WorkflowWorkerLocalObservationEvent): void {
    try {
      this.#engine.observeWorkerOperation?.({
        workerId: this.#workerId,
        ...event,
      });
    } catch {
      return;
    }
  }

  async #sleep(duration: number, signal: AbortSignal | undefined): Promise<void> {
    if (duration <= 0 || this.#stopRequested || signal?.aborted === true) {
      await Promise.resolve();
      return;
    }

    await new Promise<void>((resolve) => {
      let timer: TimeoutHandle | undefined;
      const finish = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        this.#pollWakeups.delete(finish);
        signal?.removeEventListener("abort", finish);
        resolve();
      };

      this.#pollWakeups.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
      timer = setTimeout(finish, duration);
    });
  }

  async #idlePollDelay(
    options: WorkflowWorkerRunFilterOptions,
    pollInterval: number,
    tickSchedules: boolean,
  ): Promise<number> {
    if (pollInterval <= 0 || this.#engine.getRunSummary === undefined) {
      return pollInterval;
    }

    const timestamp = this.#now();
    const summary = await this.#engine.getRunSummary(options);
    const summaryWakeAt = earliestSummaryWakeAt(summary, timestamp);
    const scheduleWakeAt = tickSchedules ? await this.#nextScheduleWakeAt() : undefined;
    const nextWakeAt =
      summaryWakeAt === undefined
        ? scheduleWakeAt
        : scheduleWakeAt === undefined ||
            Temporal.Instant.compare(summaryWakeAt, scheduleWakeAt) <= 0
          ? summaryWakeAt
          : scheduleWakeAt;
    if (nextWakeAt === undefined) {
      return pollInterval;
    }

    return Math.min(
      pollInterval,
      nonNegativeTimerDelay(durationBetween(timestamp, nextWakeAt), "Workflow idle poll delay")
        .clampedDelay,
    );
  }

  async #nextScheduleWakeAt(): Promise<Temporal.Instant | undefined> {
    if (this.#engine.listSchedules === undefined) {
      return undefined;
    }
    return (await this.#engine.listSchedules({ status: "active", limit: 1 }))[0]?.nextFireAt;
  }
}

function earliestSummaryWakeAt(
  summary: WorkflowRunSummary,
  timestamp: Temporal.Instant,
): Temporal.Instant | undefined {
  if (summary.lease.expired > 0) {
    return timestamp;
  }
  const nextAt =
    summary.nextAvailableAt === undefined
      ? summary.retry.nextRetryAt
      : summary.retry.nextRetryAt === undefined ||
          Temporal.Instant.compare(summary.nextAvailableAt, summary.retry.nextRetryAt) <= 0
        ? summary.nextAvailableAt
        : summary.retry.nextRetryAt;
  if (nextAt === undefined) {
    return summary.lease.nextExpiresAt;
  }
  if (summary.lease.nextExpiresAt === undefined) {
    return nextAt;
  }
  return Temporal.Instant.compare(summary.lease.nextExpiresAt, nextAt) < 0
    ? summary.lease.nextExpiresAt
    : nextAt;
}
