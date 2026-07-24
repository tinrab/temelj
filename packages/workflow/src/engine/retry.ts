import type {
  WorkflowMissingImplementationRetryConfig,
  WorkflowMissingImplementationRetryDefaults,
  WorkflowResolvedMissingImplementationRetryConfig,
  WorkflowResolvedRetryConfig,
  WorkflowResolvedRetryDefaults,
  WorkflowResolvedStepRetryConfig,
  WorkflowRetryConfig,
} from "../types/retry.ts";
import type { WorkflowStepRunWorkflowOptions } from "../types/step.ts";

import {
  WorkflowDurationError,
  WorkflowOptionsError,
  WorkflowRetryableError,
  WorkflowSerializationError,
  WorkflowStepAttemptLimitError,
} from "../errors/mod.ts";
import { WorkflowHistory } from "../history/mod.ts";
import { EventRecord } from "../types/events.ts";
import { RunId } from "../types/run.ts";
import {
  durationAmount,
  isPositiveSafeInteger,
  nextPositiveSafeInteger,
  resolveSafeRetryDelay,
} from "../utility.ts";

const DEFAULT_STEP_RETRY_CONFIG: WorkflowResolvedStepRetryConfig = {
  maximumAttempts: 10,
  backoffCoefficient: 2,
};

interface WorkflowEngineRetryLimits {
  readonly maximumEventHistoryEvents?: number;
}

type WorkflowResolvedMissingImplementationRetryInput =
  Partial<WorkflowMissingImplementationRetryDefaults> & {
    readonly maximumInterval?: Temporal.Duration;
  };

/** Resolves retry options and merges them with defaults used by workflow or step execution. */
export function resolveWorkflowRetryConfig(
  config: WorkflowRetryConfig | undefined,
  defaults: WorkflowResolvedRetryDefaults,
  label: string,
): WorkflowResolvedRetryConfig {
  const input = config ?? {};
  if (
    input.initialInterval !== undefined &&
    input.maximumInterval !== undefined &&
    Temporal.Duration.compare(input.maximumInterval, input.initialInterval) < 0
  ) {
    WorkflowOptionsError.retryMaximumIntervalTooSmall(label);
  }
  return {
    maximumAttempts: input.maximumAttempts ?? defaults.maximumAttempts,
    ...(input.initialInterval === undefined ? {} : { initialInterval: input.initialInterval }),
    backoffCoefficient: input.backoffCoefficient ?? defaults.backoffCoefficient,
    ...(input.maximumInterval === undefined ? {} : { maximumInterval: input.maximumInterval }),
  };
}

/** Resolves missing-implementation retry options and merges them with worker defaults. */
export function resolveMissingImplementationRetryConfig(
  config: WorkflowMissingImplementationRetryConfig | undefined,
  defaults: WorkflowMissingImplementationRetryDefaults,
  label: string,
): WorkflowResolvedMissingImplementationRetryConfig {
  const input: WorkflowResolvedMissingImplementationRetryInput = config === undefined ? {} : config;
  const initialInterval = input.initialInterval ?? defaults.initialInterval;
  const maximumInterval = input.maximumInterval;
  if (
    maximumInterval !== undefined &&
    Temporal.Duration.compare(maximumInterval, initialInterval) < 0
  ) {
    WorkflowOptionsError.retryMaximumIntervalTooSmall(label);
  }
  return {
    initialInterval,
    backoffCoefficient: input.backoffCoefficient ?? defaults.backoffCoefficient,
    maximumAttempts: input.maximumAttempts ?? defaults.maximumAttempts,
    ...(maximumInterval === undefined ? {} : { maximumInterval }),
  };
}

export function resolveChildWorkflowRetryConfig(
  options: WorkflowStepRunWorkflowOptions | undefined,
): WorkflowResolvedStepRetryConfig {
  if (options?.retry === undefined) {
    return {
      maximumAttempts: 1,
      backoffCoefficient: DEFAULT_STEP_RETRY_CONFIG.backoffCoefficient,
    };
  }
  return resolveWorkflowRetryConfig(
    options.retry,
    DEFAULT_STEP_RETRY_CONFIG,
    "Workflow step retry",
  );
}

export function shouldRetryWorkflowAttempt(
  retry: WorkflowResolvedRetryConfig,
  failedAttempt: number,
): boolean {
  return retry.maximumAttempts === 0 || failedAttempt < retry.maximumAttempts;
}

export function nextWorkflowRetryAttempt(failedAttempt: number): number {
  const nextAttempt = nextPositiveSafeInteger(failedAttempt);
  if (nextAttempt === undefined) {
    WorkflowOptionsError.positiveSafeInteger("Workflow retry next attempt");
  }
  return nextAttempt;
}

export function enforceStepAttemptBudget(
  runId: RunId,
  history: WorkflowHistory,
  maximumStepAttemptsPerRun: number,
): void {
  if (history.totalStartedStepCount() >= maximumStepAttemptsPerRun) {
    WorkflowStepAttemptLimitError.exceeded(runId, maximumStepAttemptsPerRun);
  }
}

export function enforceWorkflowEventHistoryNextLimit(
  events: readonly EventRecord[],
  limits: WorkflowEngineRetryLimits,
): void {
  if (
    limits.maximumEventHistoryEvents !== undefined &&
    events.length >= limits.maximumEventHistoryEvents
  ) {
    WorkflowSerializationError.notSerializable(
      "workflow event history",
      `event count would exceed maximumEventHistoryEvents ${limits.maximumEventHistoryEvents}`,
    );
  }
}

export function nextRetryAt(
  failedAt: Temporal.Instant,
  retry: WorkflowResolvedRetryConfig,
  failedAttempt: number,
  label: string,
): Temporal.Instant | undefined {
  if (retry.initialInterval === undefined) {
    return undefined;
  }
  if (!isPositiveSafeInteger(failedAttempt)) {
    WorkflowOptionsError.positiveSafeInteger(`${label} attempt`);
  }

  const exponentialDelay =
    durationAmount(retry.initialInterval, label) * retry.backoffCoefficient ** (failedAttempt - 1);
  const cappedDelay =
    retry.maximumInterval === undefined
      ? exponentialDelay
      : Math.min(exponentialDelay, durationAmount(retry.maximumInterval, label));
  return failedAt.add(
    Temporal.Duration.from({ milliseconds: resolveSafeRetryDelay(cappedDelay, label) }),
  );
}

export function retryClassificationRetryAt(
  failedAt: Temporal.Instant,
  error: unknown,
  label: string,
): Temporal.Instant | undefined {
  if (!(error instanceof WorkflowRetryableError)) {
    return undefined;
  }
  if (error.retryAt !== undefined) {
    if (!(error.retryAt instanceof Temporal.Instant)) {
      WorkflowDurationError.retryAtInstant(label);
    }
    return error.retryAt;
  }
  if (error.retryDelay !== undefined) {
    const retryDelay = durationAmount(error.retryDelay, label);
    return failedAt.add(
      Temporal.Duration.from({ milliseconds: resolveSafeRetryDelay(retryDelay, label) }),
    );
  }
  return undefined;
}
