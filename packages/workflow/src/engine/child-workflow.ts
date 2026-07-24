import type { Logger } from "@temelj/log";

import { deepEquals } from "@temelj/value";

import type { WorkflowDefinition } from "../types/definition.ts";
import type { WorkflowStartTarget } from "../types/definition.ts";
import type {
  WorkflowDeterministicBytesContext,
  WorkflowDeterministicValueContext,
  WorkflowExecutionLimits,
  WorkflowRecordedIdContext,
} from "../types/engine-options.ts";
import type {
  WorkflowExecutionEnvironment,
  WorkflowExecutionEnvironmentStore,
  WorkflowRunCanceler,
  WorkflowRunStarter,
} from "../types/engine.ts";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { EventRecord } from "../types/events.ts";
import type { WorkflowResolvedStepRetryConfig } from "../types/retry.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type {
  StepId,
  WorkflowChildWorkflowCancellationPolicy,
  WorkflowStepWorkflowApi,
  WorkflowStepRunWorkflowOptions,
  WorkflowStepStartWorkflowOptions,
} from "../types/step.ts";
import type { Telemetry } from "../types/telemetry.ts";

import { defineWorkflowFromTarget } from "../definition.ts";
import { WorkflowOptionsError } from "../errors/base.ts";
import { WorkflowDurationError, WorkflowReplayDivergenceError } from "../errors/failures.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import {
  WorkflowChildWorkflowTimeoutError,
  WorkflowRunCanceledError,
  WorkflowRunInvalidError,
} from "../errors/run.ts";
import { WorkflowStepAttemptLimitError, WorkflowStepExecutionError } from "../errors/step.ts";
import { WorkflowHistory, type WorkflowStepIdentity } from "../history/mod.ts";
import { isPositiveSafeInteger, nextPositiveSafeInteger, safeDuration } from "../utility.ts";
import { resolveWorkflowCommandIdentityFromCandidates } from "./command-identity.ts";
import {
  appendDurableStepStartedEvent,
  appendDurableStepTerminalEvent,
} from "./durable-command.ts";
import { requireRecordedDurableTerminalStarted } from "./replay.ts";
import { enforceStepAttemptBudget, nextRetryAt, resolveChildWorkflowRetryConfig } from "./retry.ts";
import { serializeError, toOptionalPersistedValue } from "./serialization.ts";
import { requireCurrentExecutionOwner, getRequiredRun, WorkflowSuspended } from "./state.ts";

export interface WorkflowChildWorkflowEngine extends WorkflowRunStarter, WorkflowRunCanceler {}

type ChildWorkflowStartedEvent = Extract<EventRecord, { readonly kind: "child_workflow_started" }>;
type WorkflowRecordedIdFactory = (context: WorkflowRecordedIdContext) => string;
type WorkflowDeterministicRandomFactory = (context: WorkflowDeterministicValueContext) => number;
type WorkflowDeterministicUuidFactory = (context: WorkflowDeterministicValueContext) => string;
type WorkflowDeterministicBytesFactory = (context: WorkflowDeterministicBytesContext) => Uint8Array;
type WorkflowChildWorkflowStartedObserver = (
  runId: RunId,
  event: ChildWorkflowStartedEvent,
) => void;

export function createWorkflowStepWorkflowApi(
  environment: WorkflowExecutionEnvironment,
  engine: WorkflowChildWorkflowEngine,
): WorkflowStepWorkflowApi {
  return {
    async run<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
      input: TRawInput,
      options?: WorkflowStepRunWorkflowOptions,
    ): Promise<TOutput> {
      return await runChildWorkflow(
        environment,
        engine,
        defineWorkflowFromTarget(workflow),
        input,
        options,
      );
    },

    async start<TInput, TOutput, TRawInput = TInput>(
      workflow: WorkflowStartTarget<TInput, TOutput, TRawInput>,
      input: TRawInput,
      options?: WorkflowStepStartWorkflowOptions,
    ): Promise<string> {
      return await startBackgroundChildWorkflow(
        environment,
        engine,
        defineWorkflowFromTarget(workflow),
        input,
        options,
      );
    },
  };
}

export async function runChildWorkflow<TInput, TOutput, TRawInput = TInput>(
  environment: WorkflowExecutionEnvironment,
  engine: WorkflowChildWorkflowEngine,
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  input: TRawInput,
  options: WorkflowStepRunWorkflowOptions | undefined,
): Promise<TOutput> {
  const { store, runId, history, now, maximumStepAttemptsPerRun, limits, executionOwner } =
    environment;
  const identity = resolveWorkflowCommandIdentityFromCandidates(
    history,
    "workflow",
    [options?.commandId, options?.name, definition.name],
    "Workflow child commandId, name, or definition name",
  );
  const started = history.startedChildWorkflow(identity.id);
  const completed = history.completedChildWorkflow(identity.id);
  if (completed !== undefined) {
    requireRecordedDurableTerminalStarted(
      identity,
      history.hasStartedEventBeforeTerminalEvent(completed),
    );
    if (started === undefined || isChildWorkflowTerminalForStartedAttempt(completed, started)) {
      requireChildWorkflowReplayMatches(
        runId,
        identity,
        started,
        definition,
        input,
        options,
        limits,
      );
      recordedChildWorkflowCompletionTimestamp(identity, completed.timestamp);
      return completed.result as TOutput;
    }
  }

  const retry = resolveChildWorkflowRetryConfig(options);
  const failed = history.failedChildWorkflow(identity.id);
  if (failed !== undefined) {
    requireRecordedDurableTerminalStarted(
      identity,
      history.hasStartedEventBeforeTerminalEvent(failed),
    );
  }
  if (started !== undefined) {
    requireRecordedChildWorkflowStartedAttempt(identity, started);
    requireChildWorkflowReplayMatches(runId, identity, started, definition, input, options, limits);
  }
  const pollInterval = resolveChildWorkflowPollInterval(options);
  const latestFailedAttempt =
    failed !== undefined &&
    (started === undefined || isChildWorkflowTerminalForStartedAttempt(failed, started))
      ? failed
      : undefined;
  if (latestFailedAttempt !== undefined) {
    const failedAt = recordedChildWorkflowFailureTimestamp(identity, latestFailedAttempt.timestamp);
    const nextAttempt = nextChildWorkflowRetryAttempt(
      runId,
      latestFailedAttempt.attempt,
      maximumStepAttemptsPerRun,
    );
    if (retry.maximumAttempts !== 0 && nextAttempt > retry.maximumAttempts) {
      WorkflowStepExecutionError.failed({
        stepId: identity.id,
        stepName: identity.name,
        attempt: latestFailedAttempt.attempt,
        cause: workflowErrorFromRecord(latestFailedAttempt.error),
      });
    }
    const retryAt = nextRetryAt(
      failedAt,
      retry,
      latestFailedAttempt.attempt,
      "Workflow step retry delay",
    );
    if (retryAt !== undefined && Temporal.Instant.compare(retryAt, now()) > 0) {
      WorkflowSuspended.forStepRetry(retryAt, identity, nextAttempt);
    }
  }

  const attempt =
    latestFailedAttempt === undefined ? (started?.attempt ?? 1) : latestFailedAttempt.attempt + 1;
  const childRunId =
    started === undefined || latestFailedAttempt !== undefined
      ? await startChildWorkflow(
          store,
          engine,
          runId,
          history,
          now,
          maximumStepAttemptsPerRun,
          identity,
          definition,
          input,
          options,
          attempt,
          limits,
          executionOwner,
          environment.createRecordedId,
          environment.createDeterministicRandom,
          environment.createDeterministicUuid,
          environment.createDeterministicBytes,
          environment.telemetry,
          environment.logger,
          environment.replaying,
          environment.observeChildWorkflowStarted,
        )
      : started.childRunId;
  const childRun = await getRequiredRun(store, childRunId);
  const activeStarted = history.startedChildWorkflow(identity.id);
  const timeoutAt =
    activeStarted?.timeoutAt === undefined
      ? undefined
      : recordedChildWorkflowTimeoutAt(identity, activeStarted.timeoutAt);
  if (!childRunMatchesParentStepAttempt(childRun, runId, identity, attempt)) {
    WorkflowSuspended.until(childWorkflowPollAt(now(), childRun, pollInterval));
  }

  if (
    timeoutAt !== undefined &&
    Temporal.Instant.compare(timeoutAt, now()) <= 0 &&
    childRun.status !== "completed" &&
    childRun.status !== "failed" &&
    childRun.status !== "canceled"
  ) {
    const error = childWorkflowTimeoutErrorRecord({
      runId,
      childRunId,
      stepId: identity.id,
      timeoutAt,
    });
    await appendDurableStepTerminalEvent(environment, {
      kind: "child_workflow_failed",
      timestamp: now(),
      stepId: identity.id,
      stepName: identity.name,
      attempt,
      childRunId,
      error,
    });
    await requireCurrentExecutionOwner(store, runId, executionOwner);
    await engine.cancelRun(childRunId);
    if (retry.maximumAttempts === 0 || attempt < retry.maximumAttempts) {
      suspendChildWorkflowRetry(
        runId,
        timeoutAt,
        retry,
        identity,
        attempt,
        maximumStepAttemptsPerRun,
      );
    }
    WorkflowStepExecutionError.failed({
      stepId: identity.id,
      stepName: identity.name,
      attempt,
      cause: workflowErrorFromRecord(error),
    });
  }

  if (childRun.status === "completed") {
    await appendDurableStepTerminalEvent(environment, {
      kind: "child_workflow_completed",
      timestamp: now(),
      stepId: identity.id,
      stepName: identity.name,
      attempt,
      childRunId,
      result: childRun.output,
    });
    return childRun.output as TOutput;
  }

  if (childRun.status === "failed" || childRun.status === "canceled") {
    const error =
      childRun.error ??
      (childRun.status === "canceled"
        ? serializeError(WorkflowRunCanceledError.create(childRun.id))
        : {
            name: "WorkflowError",
            message: `Child workflow failed: ${childRun.id}`,
          });
    const failedAt =
      childRun.finishedAt === undefined
        ? now()
        : childRun.finishedAt instanceof Temporal.Instant
          ? childRun.finishedAt
          : (() => {
              WorkflowRunInvalidError.invalid(
                childRun.id,
                "Workflow child failure timestamp must be valid",
              );
            })();
    await appendDurableStepTerminalEvent(environment, {
      kind: "child_workflow_failed",
      timestamp: failedAt,
      stepId: identity.id,
      stepName: identity.name,
      attempt,
      childRunId,
      error,
    });
    if (childRun.status === "canceled") {
      WorkflowStepExecutionError.failed({
        stepId: identity.id,
        stepName: identity.name,
        attempt,
        cause: workflowErrorFromRecord(error),
      });
    }
    if (retry.maximumAttempts === 0 || attempt < retry.maximumAttempts) {
      const nextAttempt = nextChildWorkflowRetryAttempt(runId, attempt, maximumStepAttemptsPerRun);
      WorkflowSuspended.forStepRetry(
        nextRetryAt(failedAt, retry, attempt, "Workflow step retry delay") ?? failedAt,
        identity,
        nextAttempt,
      );
    }
    WorkflowStepExecutionError.failed({
      stepId: identity.id,
      stepName: identity.name,
      attempt,
      cause: workflowErrorFromRecord(error),
    });
  }

  WorkflowSuspended.until(childWorkflowPollAt(now(), childRun, pollInterval));
}

export async function startBackgroundChildWorkflow<TInput, TOutput, TRawInput = TInput>(
  environment: WorkflowExecutionEnvironment,
  engine: WorkflowChildWorkflowEngine,
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  input: TRawInput,
  options: WorkflowStepStartWorkflowOptions | undefined,
): Promise<string> {
  const { store, runId, history, now, maximumStepAttemptsPerRun, limits, executionOwner } =
    environment;
  const identity = resolveWorkflowCommandIdentityFromCandidates(
    history,
    "workflow",
    [options?.commandId, options?.name, definition.name],
    "Workflow child commandId, name, or definition name",
  );
  const started = history.startedChildWorkflow(identity.id);
  if (started !== undefined) {
    requireRecordedChildWorkflowStartedAttempt(identity, started);
    requireChildWorkflowReplayMatches(runId, identity, started, definition, input, options, limits);
    return started.childRunId;
  }

  return await startChildWorkflow(
    store,
    engine,
    runId,
    history,
    now,
    maximumStepAttemptsPerRun,
    identity,
    definition,
    input,
    options,
    1,
    limits,
    executionOwner,
    environment.createRecordedId,
    environment.createDeterministicRandom,
    environment.createDeterministicUuid,
    environment.createDeterministicBytes,
    environment.telemetry,
    environment.logger,
    environment.replaying,
    environment.observeChildWorkflowStarted,
  );
}

function childRunMatchesParentStepAttempt(
  childRun: WorkflowRunRecord,
  parentRunId: RunId,
  identity: WorkflowStepIdentity,
  attempt: number,
): boolean {
  return (
    childRun.parentRunId === parentRunId &&
    childRun.parentStepId === identity.id &&
    childRun.parentStepName === identity.name &&
    childRun.parentStepAttempt === attempt
  );
}

function isChildWorkflowTerminalForStartedAttempt(
  terminal: Extract<
    EventRecord,
    { readonly kind: "child_workflow_completed" | "child_workflow_failed" }
  >,
  started: Extract<EventRecord, { readonly kind: "child_workflow_started" }>,
): boolean {
  return terminal.attempt === started.attempt && terminal.childRunId === started.childRunId;
}

function recordedChildWorkflowTimeoutAt(
  identity: WorkflowStepIdentity,
  value: Temporal.Instant,
): Temporal.Instant {
  if (value instanceof Temporal.Instant) {
    return value;
  }

  WorkflowReplayDivergenceError.diverged(
    `recorded workflow step ${identity.id} has invalid timeout timestamp: ` + String(value),
    {
      expectedStepId: identity.id,
      actualStepId: identity.id,
    },
  );
}

function recordedChildWorkflowCompletionTimestamp(
  identity: WorkflowStepIdentity,
  value: Temporal.Instant,
): Temporal.Instant {
  if (value instanceof Temporal.Instant) {
    return value;
  }

  WorkflowReplayDivergenceError.diverged(
    `recorded workflow step ${identity.id} has invalid completion timestamp: ` + String(value),
    {
      expectedStepId: identity.id,
      actualStepId: identity.id,
    },
  );
}

function recordedChildWorkflowFailureTimestamp(
  identity: WorkflowStepIdentity,
  value: Temporal.Instant,
): Temporal.Instant {
  if (value instanceof Temporal.Instant) {
    return value;
  }

  WorkflowReplayDivergenceError.diverged(
    `recorded workflow step ${identity.id} has invalid failure timestamp: ` + String(value),
    {
      expectedStepId: identity.id,
      actualStepId: identity.id,
    },
  );
}

function requireChildWorkflowReplayMatches(
  runId: RunId,
  identity: WorkflowStepIdentity,
  started: Extract<EventRecord, { readonly kind: "child_workflow_started" }> | undefined,
  definition: WorkflowDefinition<unknown, unknown>,
  input: unknown,
  options: WorkflowStepRunWorkflowOptions | undefined,
  limits: WorkflowExecutionLimits,
): void {
  if (started === undefined) {
    return;
  }
  const replayChildRunId =
    options?.id === undefined
      ? undefined
      : started.attempt === 1
        ? options.id
        : `${options.id}:attempt:${started.attempt}`;
  const replayIdempotencyKey = childWorkflowIdempotencyKey(
    runId,
    identity,
    options,
    started.attempt,
  );
  const replayCancellation = resolveChildWorkflowCancellationPolicy(options);
  if (
    started.workflowName === definition.name &&
    started.workflowVersion === definition.version &&
    (replayChildRunId === undefined || started.childRunId === replayChildRunId) &&
    started.idempotencyKey === replayIdempotencyKey &&
    (started.cancellation ?? "cascade") === replayCancellation &&
    deepEquals(started.input, toOptionalPersistedValue(input, "child workflow input", limits)) &&
    (started.timeoutAt === undefined) === (options?.timeout === undefined)
  ) {
    return;
  }

  const recordedWorkflow =
    started.workflowVersion === undefined
      ? started.workflowName
      : `${started.workflowName}@${started.workflowVersion}`;
  const replayWorkflow =
    definition.version === undefined ? definition.name : `${definition.name}@${definition.version}`;
  let message: string;
  if (recordedWorkflow !== replayWorkflow) {
    message =
      `recorded workflow step ${identity.id} targeted ${recordedWorkflow}, ` +
      `but replay targeted ${replayWorkflow}`;
  } else if (replayChildRunId !== undefined && started.childRunId !== replayChildRunId) {
    message =
      `recorded workflow step ${identity.id} started child run ${started.childRunId}, ` +
      `but replay requested child run ${replayChildRunId}`;
  } else if (started.idempotencyKey !== replayIdempotencyKey) {
    const recordedIdempotencyKey = started.idempotencyKey ?? "no idempotency key";
    message =
      `recorded workflow step ${identity.id} used child idempotency key ` +
      `${recordedIdempotencyKey}, but replay used ${replayIdempotencyKey}`;
  } else if ((started.cancellation ?? "cascade") !== replayCancellation) {
    message =
      `recorded workflow step ${identity.id} used child cancellation policy ` +
      `${started.cancellation ?? "cascade"}, but replay used ` +
      `${replayCancellation}`;
  } else if (
    !deepEquals(started.input, toOptionalPersistedValue(input, "child workflow input", limits))
  ) {
    message = `recorded workflow step ${identity.id} targeted ${recordedWorkflow} with different input`;
  } else {
    const recordedTimeout = started.timeoutAt === undefined ? "no timeout" : started.timeoutAt;
    const replayTimeout = options?.timeout === undefined ? "no timeout" : "a timeout";
    message =
      `recorded workflow step ${identity.id} had ${String(recordedTimeout)}, ` +
      `but replay used ${replayTimeout}`;
  }
  WorkflowReplayDivergenceError.diverged(message, {
    expectedStepId: identity.id,
    actualStepId: identity.id,
  });
}

function requireRecordedChildWorkflowStartedAttempt(
  identity: WorkflowStepIdentity,
  started: Extract<EventRecord, { readonly kind: "child_workflow_started" }>,
): void {
  if (isPositiveSafeInteger(started.attempt)) {
    return;
  }

  WorkflowReplayDivergenceError.diverged(
    `recorded workflow step ${identity.id} has an invalid attempt number`,
    {
      expectedStepId: identity.id,
      actualStepId: identity.id,
    },
  );
}

function suspendChildWorkflowRetry(
  runId: RunId,
  failedAt: Temporal.Instant,
  retry: WorkflowResolvedStepRetryConfig,
  identity: WorkflowStepIdentity,
  attempt: number,
  maximumStepAttemptsPerRun: number,
): never {
  WorkflowSuspended.forStepRetry(
    nextRetryAt(failedAt, retry, attempt, "Workflow step retry delay") ?? failedAt,
    identity,
    nextChildWorkflowRetryAttempt(runId, attempt, maximumStepAttemptsPerRun),
  );
}

function nextChildWorkflowRetryAttempt(
  runId: RunId,
  failedAttempt: number,
  maximumStepAttemptsPerRun: number,
): number {
  const nextAttempt = nextPositiveSafeInteger(failedAttempt);
  if (nextAttempt === undefined) {
    WorkflowStepAttemptLimitError.exceeded(runId, maximumStepAttemptsPerRun);
  }
  return nextAttempt;
}

async function startChildWorkflow<TInput, TOutput, TRawInput = TInput>(
  store: WorkflowExecutionEnvironmentStore,
  engine: WorkflowChildWorkflowEngine,
  runId: RunId,
  history: WorkflowHistory,
  now: () => Temporal.Instant,
  maximumStepAttemptsPerRun: number,
  identity: WorkflowStepIdentity,
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  input: TRawInput,
  options: WorkflowStepRunWorkflowOptions | undefined,
  attempt: number,
  limits: WorkflowExecutionLimits,
  executionOwner: WorkflowRunRecord,
  createRecordedId: WorkflowRecordedIdFactory,
  createDeterministicRandom: WorkflowDeterministicRandomFactory,
  createDeterministicUuid: WorkflowDeterministicUuidFactory,
  createDeterministicBytes: WorkflowDeterministicBytesFactory,
  telemetry: Telemetry | undefined,
  logger: Logger,
  replaying: boolean,
  observeChildWorkflowStarted: WorkflowChildWorkflowStartedObserver | undefined,
): Promise<string> {
  await requireCurrentExecutionOwner(store, runId, executionOwner);
  enforceStepAttemptBudget(runId, history, maximumStepAttemptsPerRun);
  const timeoutAt = childWorkflowTimeoutAt(now(), options);
  const deadlineAt = childWorkflowDeadlineAt(timeoutAt, executionOwner.deadlineAt);
  const idempotencyKey = childWorkflowIdempotencyKey(runId, identity, options, attempt);
  const cancellation = resolveChildWorkflowCancellationPolicy(options);
  const persistedInput = toOptionalPersistedValue(input, "child workflow input", limits);
  const handle = await engine.startWorkflow(definition, input, {
    ...(options?.id === undefined
      ? {}
      : { id: attempt === 1 ? options.id : `${options.id}:attempt:${attempt}` }),
    idempotencyKey,
    ...(deadlineAt === undefined ? {} : { deadlineAt }),
    parent: {
      runId,
      stepId: identity.id,
      stepName: identity.name,
      stepAttempt: attempt,
    },
  });
  const startedEvent: ChildWorkflowStartedEvent = {
    kind: "child_workflow_started",
    timestamp: now(),
    stepId: identity.id,
    stepName: identity.name,
    count: identity.count,
    attempt,
    childRunId: handle.runId,
    workflowName: definition.name,
    ...(definition.version === undefined ? {} : { workflowVersion: definition.version }),
    cancellation,
    input: persistedInput,
    idempotencyKey,
    ...(timeoutAt === undefined ? {} : { timeoutAt }),
  };
  await appendDurableStepStartedEvent(
    {
      store,
      runId,
      history,
      now,
      createRecordedId,
      createDeterministicRandom,
      createDeterministicUuid,
      createDeterministicBytes,
      maximumStepAttemptsPerRun,
      limits,
      executionOwner,
      telemetry,
      logger,
      replaying,
    },
    startedEvent,
  );
  observeChildWorkflowStarted?.(runId, startedEvent);
  return handle.runId;
}

function childWorkflowPollAt(
  now: Temporal.Instant,
  childRun: WorkflowRunRecord,
  pollInterval: number,
): Temporal.Instant {
  if (hasDueChildSchedule(now, childRun)) {
    return now.add(Temporal.Duration.from({ milliseconds: Math.min(pollInterval, 100) }));
  }
  const future = [
    childRun.availableAt,
    childRun.retryAt,
    childRun.deadlineAt,
    childRun.leaseExpiresAt,
    now.add(Temporal.Duration.from({ milliseconds: pollInterval })),
  ]
    .filter((value): value is Temporal.Instant => value !== undefined)
    .filter((value) => Temporal.Instant.compare(value, now) > 0)
    .sort((left, right) => Temporal.Instant.compare(left, right));
  return future[0] ?? now;
}

function resolveChildWorkflowPollInterval(
  options: WorkflowStepRunWorkflowOptions | undefined,
): number {
  const pollInterval =
    options?.pollInterval === undefined ? 100 : options.pollInterval.total({ unit: "millisecond" });
  if (!isPositiveSafeInteger(pollInterval)) {
    WorkflowDurationError.childPollIntervalTimerSafe();
  }
  return pollInterval;
}

function hasDueChildSchedule(now: Temporal.Instant, childRun: WorkflowRunRecord): boolean {
  return (
    (childRun.availableAt !== undefined &&
      Temporal.Instant.compare(childRun.availableAt, now) <= 0) ||
    (childRun.retryAt !== undefined && Temporal.Instant.compare(childRun.retryAt, now) <= 0) ||
    (childRun.deadlineAt !== undefined &&
      Temporal.Instant.compare(childRun.deadlineAt, now) <= 0) ||
    (childRun.leaseExpiresAt !== undefined &&
      Temporal.Instant.compare(childRun.leaseExpiresAt, now) <= 0)
  );
}

function childWorkflowTimeoutAt(
  now: Temporal.Instant,
  options: WorkflowStepRunWorkflowOptions | undefined,
): Temporal.Instant | undefined {
  if (options?.timeout === undefined) {
    return undefined;
  }
  const timeout = safeDuration(
    options.timeout.total({ unit: "millisecond" }),
    "Workflow child timeout",
  );
  if (timeout <= 0) {
    WorkflowDurationError.childTimeoutPositive();
  }
  return now.add(options.timeout);
}

function resolveChildWorkflowCancellationPolicy(
  options: WorkflowStepRunWorkflowOptions | WorkflowStepStartWorkflowOptions | undefined,
): WorkflowChildWorkflowCancellationPolicy {
  const policy = options?.cancellation ?? "cascade";
  if (policy !== "cascade" && policy !== "detach") {
    WorkflowOptionsError.childCancellationPolicy();
  }
  return policy;
}

function childWorkflowDeadlineAt(
  timeoutAt: Temporal.Instant | undefined,
  parentDeadlineAt: Temporal.Instant | undefined,
): Temporal.Instant | undefined {
  const deadlines = [timeoutAt, parentDeadlineAt]
    .filter((value): value is Temporal.Instant => value !== undefined)
    .sort((left, right) => Temporal.Instant.compare(left, right));
  return deadlines[0];
}

function childWorkflowTimeoutErrorRecord(options: {
  readonly runId: RunId;
  readonly childRunId: RunId;
  readonly stepId: StepId;
  readonly timeoutAt: Temporal.Instant;
}): WorkflowErrorRecord {
  const error = WorkflowChildWorkflowTimeoutError.create({
    runId: options.runId,
    childRunId: options.childRunId,
    stepId: options.stepId,
    timeoutAt: options.timeoutAt,
  });
  return {
    name: error.name,
    message: error.message,
    details: {
      runId: error.runId,
      childRunId: error.childRunId,
      stepId: error.stepId,
      timeoutAt: error.timeoutAt.toString(),
    },
  };
}

function childWorkflowIdempotencyKey(
  runId: RunId,
  identity: WorkflowStepIdentity,
  options: WorkflowStepRunWorkflowOptions | undefined,
  attempt: number,
): string {
  const base =
    options?.idempotencyKey === undefined
      ? `parent:${runId}:step:${identity.id}`
      : options.idempotencyKey;
  return `${base}:attempt:${attempt}`;
}
