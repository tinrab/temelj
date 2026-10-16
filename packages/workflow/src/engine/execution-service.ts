import type { LogAttributes, LogLevel, Logger } from "@temelj/log";

import type { IntervalHandle } from "../timer.ts";
import type {
  WorkflowDefinition,
  RunContext,
  WorkflowImplementation,
} from "../types/definition.ts";
import type {
  DeterministicBytesContext,
  RecordedIdContext,
  ExecutionLimits,
} from "../types/engine-options.ts";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { ExecutionResult } from "../types/result.ts";
import type { ResumeOptions } from "../types/run-options.ts";
import type { RunRecord } from "../types/run.ts";
import type { WorkflowStore } from "../types/store.ts";
import type { RunTelemetryContext, Telemetry } from "../types/telemetry.ts";
import type { WorkflowEngine } from "./create.ts";

import { omitUndefined } from "../collection.ts";
import { WorkflowNonRetryableError } from "../errors/failures.ts";
import { History } from "../history/replay.ts";
import { nextRunAttempt } from "../run-status.ts";
import { getRequiredRun } from "../store/query.ts";
import { withRunTelemetry, WORKFLOW_ATTRIBUTES, WORKFLOW_SYSTEM } from "../telemetry.ts";
import { isAbortError } from "../values.ts";
import { createDeterministicApi } from "./deterministic.ts";
import {
  enforceEventHistoryNextLimit,
  nextRetryAt,
  nextRetryAttempt,
  resolveRetryConfig,
  retryClassificationRetryAt,
  shouldRetryAttempt,
} from "./retry.ts";
import { makeCompletedRunResult, makeCanceledRunResult } from "./run-utils.ts";
import { serializeError, toOptionalPersistedValue } from "./serialization.ts";
import { Suspended } from "./signals.ts";
import {
  requireDefinitionMatchesRun,
  transitionRunToCompleted,
  transitionRunToRunning,
  transitionRunToExecutionWait,
  transitionRunToFailed,
  failRunForDeadline,
  isCurrentExecutionOwner,
  patchCurrentExecutionRun,
  patchRun,
  releaseLocksForRun,
  wakeParentRun,
} from "./state.ts";
import { createStepApi } from "./step-api.ts";

export interface ExecutionServiceOptions {
  readonly store: WorkflowStore;
  readonly now: () => Temporal.Instant;
  readonly createRecordedId: (context: RecordedIdContext) => string;
  readonly createDeterministicRandom: (context: RecordedIdContext) => number;
  readonly createDeterministicUuid: (context: RecordedIdContext) => string;
  readonly createDeterministicBytes: (context: DeterministicBytesContext) => Uint8Array;
  readonly maximumStepAttemptsPerRun: number;
  readonly limits: ExecutionLimits;
  readonly engine: WorkflowEngine;
  readonly readCurrentRunResult: <TOutput>(
    definition: WorkflowDefinition<unknown, TOutput, unknown>,
    runId: RunId,
  ) => Promise<ExecutionResult<TOutput>>;
  readonly emitResultLifecycleEvent: <TOutput>(
    result: ExecutionResult<TOutput>,
    previousRun?: RunRecord,
  ) => Promise<ExecutionResult<TOutput>>;
  readonly observeRunEvent: (run: RunRecord, previousRun?: RunRecord) => void;
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

export async function executeRun<TInput, TOutput, TRawInput = TInput>(
  service: ExecutionServiceOptions,
  implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  run: RunRecord,
  executionOptions: ResumeOptions | undefined,
): Promise<ExecutionResult<TOutput>> {
  return await executeRunCore(service, implementation, run, executionOptions);
}

async function executeRunCore<TInput, TOutput, TRawInput = TInput>(
  service: ExecutionServiceOptions,
  implementation: WorkflowImplementation<TInput, TOutput, TRawInput>,
  run: RunRecord,
  executionOptions: ResumeOptions | undefined,
): Promise<ExecutionResult<TOutput>> {
  requireDefinitionMatchesRun(implementation.definition, run);

  const workflowRetry = resolveRetryConfig(
    implementation.config.retry,
    {
      maximumAttempts: 1,
      backoffCoefficient: 2,
    },
    "Workflow retry",
  );

  const startedAt = service.now();
  const isClaimedRun = run.status === "running" && run.workerId !== undefined;
  enforceEventHistoryNextLimit(await service.store.getEvents(run.id), service.limits);

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
    return await service.readCurrentRunResult(implementation.definition, run.id);
  }

  if (isClaimedRun) {
    service.observeRunEvent(run);
  }

  service.observeRunEvent(runningRun, run);
  service.observeDurableEventAppended(run.id, startedEvents.at(-1)!, startedEvents);
  const history = new History(startedEvents);
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
  const deterministic = createDeterministicApi(environment);
  const step = createStepApi(environment, service.engine, executionSignal, deterministic);

  const telemetryContext: RunTelemetryContext = {
    run: runningRun,
    traceContext: run.telemetryContext,
  };

  const executeClaimedRun = async (): Promise<ExecutionResult<TOutput>> => {
    try {
      history.requireStartedEventsAreUnique();
      history.requireTerminalEventsHaveStartedEvents();
      history.requireTerminalEventsAreUnique();

      const runContext: RunContext = {
        id: runningRun.id,
        workflowName: runningRun.workflowName,
        workflowVersion: runningRun.workflowVersion,
        createdAt: runningRun.createdAt,
      };

      // SAFETY: Start and schedule creation prepare input before persistence; requireDefinitionMatchesRun verified this run belongs to the same workflow contract.
      const output = await implementation.handler({
        input: runningRun.input as TInput,
        step,
        run: runContext,
        signal: executionSignal,
      });

      history.requireReplayConsumed();
      const latestRun = await getRequiredRun(service.store, run.id);

      if (latestRun.status === "canceled") {
        return makeCanceledRunResult(latestRun);
      }

      if (!isCurrentExecutionOwner(latestRun, runningRun)) {
        return await service.readCurrentRunResult(implementation.definition, run.id);
      }

      const completedAt = service.now();
      enforceEventHistoryNextLimit(history.events, service.limits);

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
        return await service.readCurrentRunResult(implementation.definition, run.id);
      }

      const completedEvents = await service.store.appendEventIfRunCurrent(completedRun, {
        kind: "workflow_completed",
        timestamp: completedAt,
      });

      if (completedEvents === undefined) {
        return await service.readCurrentRunResult(implementation.definition, run.id);
      }

      service.observeDurableEventAppended(run.id, completedEvents.at(-1)!, completedEvents);
      await releaseLocksForRun(service.store, completedRun.id, completedAt);
      await wakeParentRun(service.store, completedRun, completedAt);

      return await service.emitResultLifecycleEvent(
        makeCompletedRunResult(implementation.definition, completedRun),
        runningRun,
      );
    } catch (error) {
      const latestRun = await service.store.getRun(run.id);

      if (latestRun?.status === "canceled") {
        return makeCanceledRunResult(latestRun);
      }

      if (latestRun === undefined || !isCurrentExecutionOwner(latestRun, runningRun)) {
        return await service.readCurrentRunResult(implementation.definition, run.id);
      }

      if (executionOptions?.signal?.aborted === true && isAbortError(error)) {
        const abortedAt = service.now();

        const waitingRun = await patchCurrentExecutionRun(
          service.store,
          runningRun,
          transitionRunToExecutionWait(runningRun, abortedAt, abortedAt),
        );

        if (waitingRun === undefined) {
          return await service.readCurrentRunResult(implementation.definition, run.id);
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

      if (error instanceof Suspended) {
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
              implementation.definition,
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
          return await service.readCurrentRunResult(implementation.definition, run.id);
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
          return await service.readCurrentRunResult(implementation.definition, run.id);
        }

        const failedEvents = await service.store.appendEventIfRunCurrent(failedRun, {
          kind: "workflow_failed",
          timestamp: failedAt,
        });

        if (failedEvents === undefined) {
          return await service.readCurrentRunResult(implementation.definition, run.id);
        }

        service.observeDurableEventAppended(run.id, failedEvents.at(-1)!, failedEvents);
        await releaseLocksForRun(service.store, failedRun.id, failedAt);
        await wakeParentRun(service.store, failedRun, failedAt);

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
        shouldRetryAttempt(workflowRetry, workflowAttempt)
      ) {
        let retryAt: Temporal.Instant;
        let nextAttempt: number;

        try {
          retryAt =
            retryClassificationRetryAt(failedAt, error, "Workflow retry classification") ??
            nextRetryAt(failedAt, workflowRetry, workflowAttempt, "Workflow retry delay") ??
            failedAt;
          nextAttempt = nextRetryAttempt(workflowAttempt);
        } catch (retryError) {
          return await failWorkflowRun(serializeError(retryError));
        }

        const deadlineAt = runningRun.deadlineAt;

        if (deadlineAt !== undefined && Temporal.Instant.compare(deadlineAt, retryAt) <= 0) {
          return await service.emitResultLifecycleEvent(
            await failRunForDeadline(
              service.store,
              implementation.definition,
              runningRun,
              deadlineAt,
              failedAt,
              runningRun,
            ),
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
          return await service.readCurrentRunResult(implementation.definition, run.id);
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

function scopedRunLogger(logger: Logger, run: RunRecord, replaying: boolean): Logger {
  return logger.child(
    omitUndefined({
      [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
      [WORKFLOW_ATTRIBUTES.workflowName]: run.workflowName,
      [WORKFLOW_ATTRIBUTES.workflowVersion]: run.workflowVersion,
      [WORKFLOW_ATTRIBUTES.runId]: run.id,
      [WORKFLOW_ATTRIBUTES.namespace]: run.namespace,
      [WORKFLOW_ATTRIBUTES.runAttempt]: run.attempts,
      [WORKFLOW_ATTRIBUTES.workerId]: run.workerId,
      [WORKFLOW_ATTRIBUTES.replay]: replaying,
    }),
  );
}

function replayAwareLogger(logger: Logger, history: History): Logger {
  return new ReplayAwareLogger(logger, history);
}

class ReplayAwareLogger implements Logger {
  readonly #logger: Logger;
  readonly #history: History;

  constructor(logger: Logger, history: History) {
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

  error(message: string, cause: unknown, attributes?: LogAttributes): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.error(message, cause, attributes);
    }
  }

  fatal(message: string, cause: unknown, attributes?: LogAttributes): void {
    if (this.#history.isReplayConsumed()) {
      this.#logger.fatal(message, cause, attributes);
    }
  }

  async flush(): Promise<void> {
    await this.#logger.flush?.();
  }

  async close(): Promise<void> {
    await this.#logger.close?.();
  }
}

interface RunCancellation {
  readonly signal: AbortSignal;
  dispose(): void;
}

function watchRunCancellationWithSignal(
  store: WorkflowStore,
  executionOwner: RunRecord,
  parentSignal: AbortSignal,
): RunCancellation {
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
