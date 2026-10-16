import type { Logger } from "@temelj/log";

import type { TimeoutHandle } from "../timer.ts";
import type { ExecutionEnvironment } from "../types/engine.ts";
import type { StepStartedEvent, StepCompletedEvent } from "../types/events.ts";
import type { RunId, StepId } from "../types/ids.ts";
import type { ResolvedRetryConfig } from "../types/retry.ts";
import type {
  WorkflowStepContext as WorkflowStepContextContract,
  StepMetadata,
  StepTaskApi,
  StepRunConfig,
} from "../types/step.ts";
import type { StepTelemetryContext } from "../types/telemetry.ts";

import {
  WorkflowDurationError,
  WorkflowNonRetryableError,
  WorkflowStepExecutionError,
  WorkflowStepRetryLimitError,
  WorkflowStepTimeoutError,
} from "../errors/mod.ts";
import { withStepTelemetry, WORKFLOW_ATTRIBUTES } from "../telemetry.ts";
import { isAbortError, safeDuration } from "../values.ts";
import { resolveCommandIdentityFromCandidates } from "./command-identity.ts";
import { appendDurableStepStartedEvent, appendDurableEvent } from "./durable-command.ts";
import {
  requireRecordedDurableStepStarted,
  requireRunStepReplayTimeoutMatches,
  isRunStepTerminalForStartedAttempt,
  recordedInstant,
  sleepUntil,
} from "./replay.ts";
import { nextRetryAt, resolveRetryConfig, retryClassificationRetryAt } from "./retry.ts";
import { serializeError, toOptionalPersistedValue } from "./serialization.ts";
import { Suspended } from "./signals.ts";

export function createStepTaskApi(
  environment: ExecutionEnvironment,
  executionSignal: AbortSignal,
): StepTaskApi {
  const { runId, history, now, limits, executionOwner, telemetry } = environment;

  const run = async <TOutput>(
    config: StepRunConfig,
    callback: (context: WorkflowStepContext) => Promise<TOutput> | TOutput,
  ): Promise<TOutput> => {
    const identity = resolveCommandIdentityFromCandidates(
      history,
      "run",
      [config.commandId, config.name],
      "Workflow step name or commandId",
    );

    const timeout =
      config.timeout === undefined
        ? undefined
        : (() => {
            const value = safeDuration(
              config.timeout.total({ unit: "millisecond" }),
              "Workflow step timeout",
            );

            if (value <= 0) {
              throw new WorkflowDurationError("Workflow step timeout must be greater than zero");
            }

            return value;
          })();

    const started = history.startedStep(identity.id);
    const completed = history.completedStep(identity.id);

    if (
      completed !== undefined &&
      (started === undefined || isRunStepTerminalForStartedAttempt(completed, started))
    ) {
      requireRecordedDurableStepStarted(
        identity,
        history.hasStartedEventBeforeTerminalEvent(completed),
      );
      requireRunStepReplayTimeoutMatches(identity, started, config);
      recordedInstant("run", identity, "completion", completed.timestamp);

      // SAFETY: The checked completion belongs to this command and started attempt; this workflow version owns the callback/result contract across replay.
      return completed.result as TOutput;
    }

    const orphanFailed = history.unstartedFailedStep(identity.id);

    if (orphanFailed !== undefined) {
      requireRecordedDurableStepStarted(identity, false);
    }

    const retry = resolveRetryConfig(
      config.retry,
      {
        maximumAttempts: 10,
        backoffCoefficient: 2,
      },
      "Workflow step retry",
    );

    let attempt = history.nextStepAttempt(identity.id);

    while (retry.maximumAttempts === 0 || attempt <= retry.maximumAttempts) {
      const startedAt = now();

      const timeoutAt =
        timeout === undefined
          ? undefined
          : startedAt.add(Temporal.Duration.from({ milliseconds: timeout }));

      const startedEvent: StepStartedEvent = {
        kind: "step_started",
        timestamp: startedAt,
        stepId: identity.id,
        stepName: identity.name,
        count: identity.count,
        attempt,
        timeoutAt,
      };

      await appendDurableStepStartedEvent(environment, startedEvent);

      const telemetryContext: StepTelemetryContext = {
        run: executionOwner,
        step: {
          id: identity.id,
          name: identity.name,
          count: identity.count,
          kind: "run" as const,
        },
        attempt,
        retry,
        timeoutAt,
      };

      try {
        const result = await withStepTelemetry(telemetry, telemetryContext, async () => {
          return await runStepCallbackWithTimeout(
            callback,
            createStepContext(
              identity,
              attempt,
              retry,
              executionSignal,
              environment.logger.child({
                [WORKFLOW_ATTRIBUTES.stepId]: identity.id,
                [WORKFLOW_ATTRIBUTES.stepName]: identity.name,
                [WORKFLOW_ATTRIBUTES.stepKind]: identity.kind,
                [WORKFLOW_ATTRIBUTES.stepAttempt]: attempt,
                [WORKFLOW_ATTRIBUTES.replay]: false,
              }),
            ),
            {
              runId,
              stepId: identity.id,
              stepName: identity.name,
              attempt,
              timeoutAt,
              timeout,
            },
          );
        });

        try {
          telemetry?.recordStepExecution?.(telemetryContext);
        } catch {
          // Telemetry failures must not affect durable step execution.
        }

        const persistedResult = toOptionalPersistedValue(result, "step result", limits);

        const completedEvent: StepCompletedEvent = {
          kind: "step_completed",
          timestamp: now(),
          stepId: identity.id,
          stepName: identity.name,
          attempt,
          result: persistedResult,
        };

        await appendDurableEvent(environment, completedEvent);

        return result;
      } catch (error) {
        if (executionSignal.aborted && isAbortError(error)) {
          throw error;
        }

        try {
          telemetry?.recordStepExecution?.({ ...telemetryContext, error });
        } catch {
          // Telemetry failures must not affect durable step execution.
        }

        const failedAt = now();
        await appendDurableEvent(environment, {
          kind: "step_failed",
          timestamp: failedAt,
          stepId: identity.id,
          stepName: identity.name,
          attempt,
          error: serializeError(error),
        });

        if (
          error instanceof WorkflowNonRetryableError ||
          (retry.maximumAttempts !== 0 && attempt >= retry.maximumAttempts)
        ) {
          WorkflowStepExecutionError.failed({
            stepId: identity.id,
            stepName: identity.name,
            attempt,
            cause: error,
          });
        }

        const retryAt =
          retryClassificationRetryAt(failedAt, error, "Workflow step retry classification") ??
          nextRetryAt(failedAt, retry, attempt, "Workflow step retry delay");

        if (retryAt !== undefined) {
          Suspended.forStepRetry(retryAt, identity, attempt + 1);
        }

        attempt++;
      }
    }

    WorkflowStepExecutionError.failed({
      stepId: identity.id,
      stepName: identity.name,
      attempt,
      cause: new WorkflowStepRetryLimitError({
        stepId: identity.id,
        stepName: identity.name,
        attempt,
      }),
    });
  };

  return {
    run,

    async call(definition, ...args) {
      return await run(definition.config, async (context) => {
        return await definition.handler(context, ...args);
      });
    },

    async sleep(commandId, duration) {
      const resolvedDuration = duration.total({ unit: "millisecond" });
      safeDuration(resolvedDuration, "Workflow sleep duration");
      const until = now().add(Temporal.Duration.from({ milliseconds: resolvedDuration }));
      await sleepUntil(environment, commandId, until, { duration });
    },

    async sleepUntil(commandId, timestamp) {
      await sleepUntil(environment, commandId, timestamp, {});
    },
  };
}

function createStepContext(
  identity: StepMetadata,
  attempt: number,
  config: ResolvedRetryConfig,
  signal: AbortSignal,
  log: Logger,
): WorkflowStepContextContract {
  return new WorkflowStepContext(identity, attempt, config, signal, log);
}

class WorkflowStepContext implements WorkflowStepContextContract {
  readonly step: StepMetadata;
  readonly attempt: number;
  readonly config: ResolvedRetryConfig;
  readonly signal: AbortSignal;
  readonly log: Logger;

  constructor(
    step: StepMetadata,
    attempt: number,
    config: ResolvedRetryConfig,
    signal: AbortSignal,
    log: Logger,
  ) {
    this.step = step;
    this.attempt = attempt;
    this.config = config;
    this.signal = signal;
    this.log = log;
  }
}

async function runStepCallbackWithTimeout<TOutput>(
  callback: (context: WorkflowStepContextContract) => Promise<TOutput> | TOutput,
  context: WorkflowStepContextContract,
  timeout: {
    readonly runId: RunId;
    readonly stepId: StepId;
    readonly stepName: string;
    readonly attempt: number;
    readonly timeoutAt?: Temporal.Instant;
    readonly timeout?: number;
  },
): Promise<TOutput> {
  if (timeout.timeoutAt === undefined || timeout.timeout === undefined) {
    return await callback(context);
  }

  const timeoutAt = timeout.timeoutAt;
  const timeoutAbort = new AbortController();

  const abortFromParent = () => {
    timeoutAbort.abort(context.signal.reason);
  };

  if (context.signal.aborted) {
    timeoutAbort.abort(context.signal.reason);
  } else {
    context.signal.addEventListener("abort", abortFromParent, { once: true });
  }

  let timeoutHandle: TimeoutHandle | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new WorkflowStepTimeoutError({
        runId: timeout.runId,
        stepId: timeout.stepId,
        stepName: timeout.stepName,
        attempt: timeout.attempt,
        timeoutAt,
      });

      timeoutAbort.abort(error);
      reject(error);
    }, timeout.timeout);
  });

  try {
    return await Promise.race([
      callback({
        ...context,
        signal: timeoutAbort.signal,
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }

    context.signal.removeEventListener("abort", abortFromParent);
  }
}
