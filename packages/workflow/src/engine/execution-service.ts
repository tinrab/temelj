import type { LogAttributes, LogLevel, Logger } from "@temelj/log";

import type { IntervalHandle } from "../timer.ts";
import type { WorkflowImplementation } from "../types/definition.ts";
import type {
  WorkflowDeterministicBytesContext,
  WorkflowDeterministicValueContext,
  WorkflowExecutionLimits,
  WorkflowRecordedIdContext,
} from "../types/engine-options.ts";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { EventRecord } from "../types/events.ts";
import type { ExecutionResult } from "../types/result.ts";
import type { WorkflowResumeOptions } from "../types/run-options.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type {
  WorkflowConditionalEventAppender,
  WorkflowEventReader,
  WorkflowLockConditionalWriterRepository,
  WorkflowLockListerRepository,
  WorkflowMessageIdempotencyIndexLookup,
  WorkflowRunListerRepository,
  WorkflowRunReaderRepository,
  WorkflowRunWriterRepository,
  WorkflowStepAttemptLookup,
} from "../types/store.ts";
import type { Telemetry } from "../types/telemetry.ts";
import type { WorkflowChildWorkflowEngine } from "./child-workflow.ts";
import type { WorkflowStepLockEngine } from "./lock.ts";

import { WorkflowNonRetryableError } from "../errors/failures.ts";
import { WorkflowHistory } from "../history/mod.ts";
import { withRunTelemetry, WORKFLOW_ATTRIBUTES, WORKFLOW_SYSTEM } from "../telemetry.ts";
import { isAbortError, nextRunAttempt } from "../utility.ts";
import { createWorkflowDeterministicApi } from "./deterministic.ts";
import {
  enforceWorkflowEventHistoryNextLimit,
  nextRetryAt,
  nextWorkflowRetryAttempt,
  resolveWorkflowRetryConfig,
  retryClassificationRetryAt,
  shouldRetryWorkflowAttempt,
} from "./retry.ts";
import { makeCompletedRunResult, makeCanceledRunResult } from "./run-utils.ts";
import { serializeError, toOptionalPersistedValue } from "./serialization.ts";
import {
  requireDefinitionMatchesRun,
  transitionRunToCompleted,
  transitionRunToRunning,
  transitionRunToExecutionWait,
  transitionRunToFailed,
  failRunForDeadline,
  getRequiredRun,
  isCurrentExecutionOwner,
  patchCurrentExecutionRun,
  patchRun,
  releaseLocksForRun,
  wakeParentRunForTerminalChild,
  WorkflowSuspended,
} from "./state.ts";
import { createStepApi } from "./step-api.ts";

type WorkflowExecutionServiceStore = WorkflowRunReaderRepository &
  WorkflowRunListerRepository &
  WorkflowRunWriterRepository &
  WorkflowMessageIdempotencyIndexLookup &
  WorkflowConditionalEventAppender &
  WorkflowEventReader &
  WorkflowStepAttemptLookup &
  WorkflowLockListerRepository &
  WorkflowLockConditionalWriterRepository;

type WorkflowExecutionStepRuntime = WorkflowChildWorkflowEngine & WorkflowStepLockEngine;

export interface WorkflowExecutionServiceOptions {
  readonly store: WorkflowExecutionServiceStore;
  readonly now: () => Temporal.Instant;
  readonly createRecordedId: (context: WorkflowRecordedIdContext) => string;
  readonly createDeterministicRandom: (context: WorkflowDeterministicValueContext) => number;
  readonly createDeterministicUuid: (context: WorkflowDeterministicValueContext) => string;
  readonly createDeterministicBytes: (context: WorkflowDeterministicBytesContext) => Uint8Array;
  readonly maximumStepAttemptsPerRun: number;
  readonly limits: WorkflowExecutionLimits;
  readonly engine: WorkflowExecutionStepRuntime;
  readonly readCurrentRunResult: <TOutput>(runId: RunId) => Promise<ExecutionResult<TOutput>>;
  readonly emitResultLifecycleEvent: <TOutput>(
    result: ExecutionResult<TOutput>,
    previousRun?: WorkflowRunRecord,
  ) => Promise<ExecutionResult<TOutput>>;
  readonly observeRunEvent: (run: WorkflowRunRecord, previousRun?: WorkflowRunRecord) => void;
  readonly observeDurableEventAppended: (
    runId: RunId,
    event: EventRecord,
    events: readonly EventRecord[],
  ) => void;
  readonly observeMessageSent: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "message_sent" }>,
  ) => void;
  readonly observeChildWorkflowStarted: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "child_workflow_started" }>,
  ) => void;
  readonly telemetry?: Telemetry;
  readonly logger: Logger;
}

export async function executeWorkflowRun<TInput, TOutput, TRawInput = TInput>(
  service: WorkflowExecutionServiceOptions,
  implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  run: WorkflowRunRecord,
  executionOptions: WorkflowResumeOptions | undefined,
): Promise<ExecutionResult<TOutput>> {
  return await executeWorkflowRunCore(service, implementation, run, executionOptions);
}

async function executeWorkflowRunCore<TInput, TOutput, TRawInput = TInput>(
  service: WorkflowExecutionServiceOptions,
  implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  run: WorkflowRunRecord,
  executionOptions: WorkflowResumeOptions | undefined,
): Promise<ExecutionResult<TOutput>> {
  requireDefinitionMatchesRun(implementation.definition, run);
  const workflowRetry = resolveWorkflowRetryConfig(
    implementation.config.retry,
    {
      maximumAttempts: 1,
      backoffCoefficient: 2,
    },
    "Workflow retry",
  );
  const startedAt = service.now();
  const isClaimedRun = run.status === "running" && run.workerId !== undefined;
  enforceWorkflowEventHistoryNextLimit(await service.store.getEvents(run.id), service.limits);
  const runningRun = await patchRun(
    service.store,
    run,
    transitionRunToRunning(
      run,
      startedAt,
      isClaimedRun ? run.attempts : nextRunAttempt(run.attempts),
    ),
  );
  const startedEvents = await service.store.appendEventIfRunCurrent(runningRun, {
    kind: "workflow_started",
    timestamp: startedAt,
  });
  if (startedEvents === undefined) {
    return await service.readCurrentRunResult<TOutput>(run.id);
  }
  if (isClaimedRun) {
    service.observeRunEvent(run);
  }
  service.observeRunEvent(runningRun, run);
  service.observeDurableEventAppended(run.id, startedEvents.at(-1)!, startedEvents);
  const history = new WorkflowHistory(startedEvents);
  const replaying = history.hasPriorWorkflowStart();
  const runLogger = scopedRunLogger(service.logger, runningRun, false);
  const handlerLogger = replaying ? replayAwareLogger(runLogger, history) : runLogger;
  const environment = {
    store: service.store,
    runId: run.id,
    history,
    now: service.now,
    createRecordedId: service.createRecordedId,
    createDeterministicRandom: service.createDeterministicRandom,
    createDeterministicUuid: service.createDeterministicUuid,
    createDeterministicBytes: service.createDeterministicBytes,
    maximumStepAttemptsPerRun: service.maximumStepAttemptsPerRun,
    limits: service.limits,
    executionOwner: runningRun,
    telemetry: service.telemetry,
    logger: handlerLogger,
    replaying,
    observeDurableEventAppended: service.observeDurableEventAppended,
    observeMessageSent: service.observeMessageSent,
    observeChildWorkflowStarted: service.observeChildWorkflowStarted,
  };

  const executionAbort = watchRunCancellationWithSignal(
    service.store,
    runningRun,
    executionOptions?.signal ?? new AbortController().signal,
  );
  const executionSignal = executionAbort.signal;
  const deterministic = createWorkflowDeterministicApi(environment);
  const step = createStepApi(environment, service.engine, executionSignal, deterministic);
  const telemetryContext = {
    run: runningRun,
    ...(run.telemetryContext === undefined ? {} : { traceContext: run.telemetryContext }),
  };

  const executeClaimedRun = async (): Promise<ExecutionResult<TOutput>> => {
    try {
      history.requireStartedEventsAreUnique();
      history.requireTerminalEventsHaveStartedEvents();
      history.requireTerminalEventsAreUnique();
      const output = await implementation.handler({
        input: runningRun.input as TInput,
        step,
        deterministic,
        log: handlerLogger,
        run: {
          id: runningRun.id,
          workflowName: runningRun.workflowName,
          ...(runningRun.workflowVersion === undefined
            ? {}
            : { workflowVersion: runningRun.workflowVersion }),
          createdAt: runningRun.createdAt,
        },
        signal: executionSignal,
        version: runningRun.workflowVersion,
      });
      history.requireReplayConsumed();
      const latestRun = await getRequiredRun(service.store, run.id);
      if (latestRun.status === "canceled") {
        return makeCanceledRunResult(latestRun);
      }
      if (!isCurrentExecutionOwner(latestRun, runningRun)) {
        return await service.readCurrentRunResult<TOutput>(run.id);
      }
      const completedAt = service.now();
      enforceWorkflowEventHistoryNextLimit(history.events, service.limits);
      const completedRun = await patchCurrentExecutionRun(
        service.store,
        runningRun,
        transitionRunToCompleted(
          runningRun,
          toOptionalPersistedValue(output, "workflow output", service.limits),
          completedAt,
        ),
      );
      if (completedRun === undefined) {
        return await service.readCurrentRunResult<TOutput>(run.id);
      }
      const completedEvents = await service.store.appendEventIfRunCurrent(completedRun, {
        kind: "workflow_completed",
        timestamp: completedAt,
      });
      if (completedEvents === undefined) {
        return await service.readCurrentRunResult<TOutput>(run.id);
      }
      service.observeDurableEventAppended(run.id, completedEvents.at(-1)!, completedEvents);
      await releaseLocksForRun(service.store, completedRun.id, completedAt);
      await wakeParentRunForTerminalChild(service.store, completedRun, completedAt);
      return await service.emitResultLifecycleEvent(
        makeCompletedRunResult<TOutput>(completedRun),
        runningRun,
      );
    } catch (error) {
      const latestRun = await service.store.getRun(run.id);
      if (latestRun?.status === "canceled") {
        return makeCanceledRunResult(latestRun);
      }
      if (latestRun === undefined || !isCurrentExecutionOwner(latestRun, runningRun)) {
        return await service.readCurrentRunResult<TOutput>(run.id);
      }

      if (executionOptions?.signal?.aborted === true && isAbortError(error)) {
        const abortedAt = service.now();
        const waitingRun = await patchCurrentExecutionRun(
          service.store,
          runningRun,
          transitionRunToExecutionWait(runningRun, abortedAt, abortedAt),
        );
        if (waitingRun === undefined) {
          return await service.readCurrentRunResult<TOutput>(run.id);
        }
        return await service.emitResultLifecycleEvent(
          {
            kind: "waiting",
            run: waitingRun,
            availableAt: abortedAt,
          },
          runningRun,
        );
      }

      if (error instanceof WorkflowSuspended) {
        const suspendedAt = service.now();
        const deadlineAt = runningRun.deadlineAt;
        if (
          deadlineAt !== undefined &&
          (error.retryReason !== undefined
            ? Temporal.Instant.compare(deadlineAt, error.availableAt) <= 0
            : Temporal.Instant.compare(deadlineAt, error.availableAt) < 0)
        ) {
          return await service.emitResultLifecycleEvent(
            await failRunForDeadline(
              service.store,
              runningRun,
              deadlineAt,
              suspendedAt,
              runningRun,
            ),
            runningRun,
          );
        }

        const waitingRun = await patchCurrentExecutionRun(
          service.store,
          runningRun,
          transitionRunToExecutionWait(runningRun, suspendedAt, error.availableAt, {
            retryAt: error.retryAt,
            retryReason: error.retryReason,
            retryAttempt: error.retryAttempt,
            retryStepId: error.retryStep?.id,
            retryStepName: error.retryStep?.name,
          }),
        );
        if (waitingRun === undefined) {
          return await service.readCurrentRunResult<TOutput>(run.id);
        }
        return await service.emitResultLifecycleEvent(
          {
            kind: "waiting",
            run: waitingRun,
            availableAt: error.availableAt,
          },
          runningRun,
        );
      }

      const failedAt = service.now();
      const serialized = serializeError(error);
      const workflowAttempt = runningRun.attempts ?? 1;
      const failWorkflowRun = async (
        errorRecord: WorkflowErrorRecord,
      ): Promise<ExecutionResult<TOutput>> => {
        const failedRun = await patchCurrentExecutionRun(
          service.store,
          runningRun,
          transitionRunToFailed(runningRun, errorRecord, failedAt, "failed"),
        );
        if (failedRun === undefined) {
          return await service.readCurrentRunResult<TOutput>(run.id);
        }
        const failedEvents = await service.store.appendEventIfRunCurrent(failedRun, {
          kind: "workflow_failed",
          timestamp: failedAt,
        });
        if (failedEvents === undefined) {
          return await service.readCurrentRunResult<TOutput>(run.id);
        }
        service.observeDurableEventAppended(run.id, failedEvents.at(-1)!, failedEvents);
        await releaseLocksForRun(service.store, failedRun.id, failedAt);
        await wakeParentRunForTerminalChild(service.store, failedRun, failedAt);
        return await service.emitResultLifecycleEvent(
          {
            kind: "failed",
            run: failedRun,
            error: errorRecord,
          },
          runningRun,
        );
      };
      if (
        !(error instanceof WorkflowNonRetryableError) &&
        shouldRetryWorkflowAttempt(workflowRetry, workflowAttempt)
      ) {
        let retryAt: Temporal.Instant;
        let nextAttempt: number;
        try {
          retryAt =
            retryClassificationRetryAt(failedAt, error, "Workflow retry classification") ??
            nextRetryAt(failedAt, workflowRetry, workflowAttempt, "Workflow retry delay") ??
            failedAt;
          nextAttempt = nextWorkflowRetryAttempt(workflowAttempt);
        } catch (retryError) {
          return await failWorkflowRun(serializeError(retryError));
        }
        const deadlineAt = runningRun.deadlineAt;
        if (deadlineAt !== undefined && Temporal.Instant.compare(deadlineAt, retryAt) <= 0) {
          return await service.emitResultLifecycleEvent(
            await failRunForDeadline(service.store, runningRun, deadlineAt, failedAt, runningRun),
            runningRun,
          );
        }

        const waitingRun = await patchCurrentExecutionRun(
          service.store,
          runningRun,
          transitionRunToExecutionWait(runningRun, failedAt, retryAt, {
            retryAt,
            retryReason: "workflow",
            retryAttempt: nextAttempt,
            error: serialized,
          }),
        );
        if (waitingRun === undefined) {
          return await service.readCurrentRunResult<TOutput>(run.id);
        }
        return await service.emitResultLifecycleEvent(
          {
            kind: "waiting",
            run: waitingRun,
            availableAt: retryAt,
          },
          runningRun,
        );
      }

      return await failWorkflowRun(serialized);
    } finally {
      executionAbort.dispose();
    }
  };

  try {
    const result = await withRunTelemetry(service.telemetry, telemetryContext, executeClaimedRun);
    try {
      service.telemetry?.recordRunExecution?.({ ...telemetryContext, result });
    } catch {
      return result;
    }
    return result;
  } catch (error) {
    try {
      service.telemetry?.recordRunExecution?.({ ...telemetryContext, error });
    } catch {
      throw error;
    }
    throw error;
  }
}

function scopedRunLogger(logger: Logger, run: WorkflowRunRecord, replaying: boolean): Logger {
  return logger.child({
    [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
    [WORKFLOW_ATTRIBUTES.workflowName]: run.workflowName,
    ...(run.workflowVersion === undefined
      ? {}
      : { [WORKFLOW_ATTRIBUTES.workflowVersion]: run.workflowVersion }),
    [WORKFLOW_ATTRIBUTES.runId]: run.id,
    [WORKFLOW_ATTRIBUTES.namespace]: run.namespace,
    [WORKFLOW_ATTRIBUTES.runAttempt]: run.attempts,
    ...(run.workerId === undefined ? {} : { [WORKFLOW_ATTRIBUTES.workerId]: run.workerId }),
    [WORKFLOW_ATTRIBUTES.replay]: replaying,
  });
}

function replayAwareLogger(logger: Logger, history: WorkflowHistory): Logger {
  return new ReplayAwareLogger(logger, history);
}

class ReplayAwareLogger implements Logger {
  readonly #logger: Logger;
  readonly #history: WorkflowHistory;

  constructor(logger: Logger, history: WorkflowHistory) {
    this.#logger = logger;
    this.#history = history;
  }

  child(attributes: LogAttributes): Logger {
    return new ReplayAwareLogger(this.#logger.child(attributes), this.#history);
  }

  log(level: LogLevel, message: string, attributes?: LogAttributes): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.log(level, message, attributes);
    }
  }

  trace(message: string, attributes?: LogAttributes): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.trace(message, attributes);
    }
  }

  debug(message: string, attributes?: LogAttributes): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.debug(message, attributes);
    }
  }

  info(message: string, attributes?: LogAttributes): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.info(message, attributes);
    }
  }

  warn(message: string, attributes?: LogAttributes): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.warn(message, attributes);
    }
  }

  error(message: string, attributes?: LogAttributes & { readonly error?: unknown }): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.error(message, attributes);
    }
  }

  fatal(message: string, attributes?: LogAttributes & { readonly error?: unknown }): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.fatal(message, attributes);
    }
  }

  async flush(): Promise<void> {
    await this.#logger.flush?.();
  }

  async close(): Promise<void> {
    await this.#logger.close?.();
  }
}

function watchRunCancellationWithSignal(
  store: WorkflowRunReaderRepository,
  executionOwner: WorkflowRunRecord,
  parentSignal: AbortSignal,
): { readonly signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  let disposed = false;
  let polling = false;
  let interval: IntervalHandle | undefined;

  const abortFromParent = () => {
    controller.abort(parentSignal.reason);
  };
  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  const poll = () => {
    if (disposed || polling || controller.signal.aborted) {
      return;
    }
    polling = true;
    void store
      .getRun(executionOwner.id)
      .then((run) => {
        if (
          !disposed &&
          !controller.signal.aborted &&
          run?.status === "canceled" &&
          run.id === executionOwner.id &&
          run.attempts === executionOwner.attempts
        ) {
          controller.abort(new DOMException("Workflow run canceled", "AbortError"));
        }
      })
      .catch(() => {})
      .finally(() => {
        polling = false;
      });
  };

  interval = setInterval(poll, 25);
  poll();

  return {
    signal: controller.signal,
    dispose() {
      disposed = true;
      if (interval !== undefined) {
        clearInterval(interval);
      }
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}
