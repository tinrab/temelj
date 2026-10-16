import type { ExecutionLimits } from "../types/engine-options.ts";
import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type {
  MissingImplementationRetryConfig,
  MissingImplementationRetryDefaults,
  ResolvedMissingImplementationRetryConfig,
  ResolvedRetryConfig,
  ResolvedRetryDefaults,
  RetryConfig,
} from "../types/retry.ts";
import type { StepRunWorkflowOptions } from "../types/step.ts";

import {
  WorkflowDurationError,
  WorkflowOptionsError,
  WorkflowRetryableError,
  WorkflowSerializationError,
  WorkflowStepAttemptLimitError,
} from "../errors/mod.ts";
import { History } from "../history/replay.ts";
import {
  isPositiveSafeInteger,
  nextPositiveSafeInteger,
  durationAmount,
  resolveSafeRetryDelay,
} from "../values.ts";

const DEFAULT_STEP_RETRY_CONFIG: ResolvedRetryConfig = {
  maximumAttempts: 10,
  backoffCoefficient: 2,
};

type ResolvedMissingImplementationRetryInput = Partial<MissingImplementationRetryDefaults> & {
  readonly maximumInterval?: Temporal.Duration;
};

/** Resolves retry options and merges them with defaults used by workflow or step execution. */
export function resolveRetryConfig(
  config: RetryConfig | undefined,
  defaults: ResolvedRetryDefaults,
  label: string,
): ResolvedRetryConfig {
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
    initialInterval: input.initialInterval,
    backoffCoefficient: input.backoffCoefficient ?? defaults.backoffCoefficient,
    maximumInterval: input.maximumInterval,
  };
}

/** Resolves missing-implementation retry options and merges them with worker defaults. */
export function resolveMissingImplementationRetryConfig(
  config: MissingImplementationRetryConfig | undefined,
  defaults: MissingImplementationRetryDefaults,
  label: string,
): ResolvedMissingImplementationRetryConfig {
  const input: ResolvedMissingImplementationRetryInput = config === undefined ? {} : config;
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
    maximumInterval,
  };
}

export function resolveChildWorkflowRetryConfig(
  options: StepRunWorkflowOptions | undefined,
): ResolvedRetryConfig {
  if (options?.retry === undefined) {
    return {
      maximumAttempts: 1,
      backoffCoefficient: DEFAULT_STEP_RETRY_CONFIG.backoffCoefficient,
    };
  }

  return resolveRetryConfig(options.retry, DEFAULT_STEP_RETRY_CONFIG, "Workflow step retry");
}

export function shouldRetryAttempt(retry: ResolvedRetryConfig, failedAttempt: number): boolean {
  return retry.maximumAttempts === 0 || failedAttempt < retry.maximumAttempts;
}

export function nextRetryAttempt(failedAttempt: number): number {
  const nextAttempt = nextPositiveSafeInteger(failedAttempt);

  if (nextAttempt === undefined) {
    WorkflowOptionsError.positiveSafeInteger("Workflow retry next attempt");
  }

  return nextAttempt;
}

export function enforceStepAttemptBudget(
  runId: RunId,
  history: History,
  maximumStepAttemptsPerRun: number,
): void {
  if (history.totalStartedStepCount() >= maximumStepAttemptsPerRun) {
    WorkflowStepAttemptLimitError.exceeded(runId, maximumStepAttemptsPerRun);
  }
}

export function enforceEventHistoryNextLimit(
  events: readonly EventRecord[],
  limits: ExecutionLimits,
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
  retry: ResolvedRetryConfig,
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
  cause: unknown,
  label: string,
): Temporal.Instant | undefined {
  if (!(cause instanceof WorkflowRetryableError)) {
    return undefined;
  }

  if (cause.retryAt !== undefined) {
    if (!(cause.retryAt instanceof Temporal.Instant)) {
      throw new WorkflowDurationError(`${label} retryAt must be a Temporal.Instant`);
    }

    return cause.retryAt;
  }

  if (cause.retryDelay !== undefined) {
    const retryDelay = durationAmount(cause.retryDelay, label);

    return failedAt.add(
      Temporal.Duration.from({ milliseconds: resolveSafeRetryDelay(retryDelay, label) }),
    );
  }

  return undefined;
}
