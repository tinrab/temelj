import "temporal-polyfill/global";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { RunId } from "../types/ids.ts";
import type { ExecutionResult } from "../types/result.ts";
import type { ResolvedMissingImplementationRetryConfig } from "../types/retry.ts";
import type { RunRecord } from "../types/run.ts";
import type { WorkflowStore } from "../types/store.ts";

import {
  patchRunIfCurrent,
  transitionRunToFailed,
  transitionRunToMissingImplementationWait,
  wakeParentRun,
} from "../engine/state.ts";
import { WorkflowOptionsError } from "../errors/base.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowImplementationNotFoundError } from "../errors/implementation.ts";
import { WorkflowRunDeadlineExceededError } from "../errors/run.ts";
import { durationTotal } from "../temporal.ts";
import { nonNegativeTimerDelay } from "../timer.ts";
import { isPositiveSafeInteger, safeDuration } from "../values.ts";
import { toWorkerErrorRecord } from "./error.ts";

interface MissingImplementationContext {
  readonly store: WorkflowStore;
  readonly now: () => Temporal.Instant;
  readonly retry: ResolvedMissingImplementationRetryConfig;
  readonly readResult: (runId: RunId) => Promise<ExecutionResult<unknown>>;
}

/** Retries a run whose implementation is not registered, or fails it once retries or its deadline run out. */
export async function handleMissingImplementation(
  context: MissingImplementationContext,
  run: RunRecord,
): Promise<ExecutionResult<unknown>> {
  const timestamp = context.now();
  const retryAttempt = run.attempts ?? (run.retryAttempt ?? 0) + 1;

  const errorRecord = toWorkerErrorRecord(
    new WorkflowImplementationNotFoundError(run.workflowName, run.workflowVersion),
  );

  const deadlineAt = run.deadlineAt;

  if (deadlineAt !== undefined && Temporal.Instant.compare(deadlineAt, timestamp) <= 0) {
    return await fail(
      context,
      run,
      deadlineErrorRecord(run, deadlineAt),
      timestamp,
      "deadline",
      deadlineAt,
    );
  }

  if (context.retry.maximumAttempts > 0 && retryAttempt >= context.retry.maximumAttempts) {
    return await fail(context, run, errorRecord, timestamp, "failed");
  }

  let availableAt: Temporal.Instant;

  try {
    availableAt = timestamp.add(
      Temporal.Duration.from({
        milliseconds: nonNegativeTimerDelay(
          retryDelay(context.retry, retryAttempt),
          "Workflow missing implementation retry delay",
        ).clampedDelay,
      }),
    );
  } catch (retryError) {
    return await fail(context, run, toWorkerErrorRecord(retryError), timestamp, "failed");
  }

  if (deadlineAt !== undefined && Temporal.Instant.compare(deadlineAt, availableAt) <= 0) {
    return await fail(
      context,
      run,
      deadlineErrorRecord(run, deadlineAt),
      timestamp,
      "deadline",
      deadlineAt,
    );
  }

  const waitingRun = await patchRunIfCurrent(
    context.store,
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
    return await context.readResult(run.id);
  }

  await wakeParentRun(context.store, waitingRun, availableAt);

  return {
    kind: "waiting",
    run: waitingRun,
    availableAt,
  };
}

async function fail(
  context: MissingImplementationContext,
  run: RunRecord,
  errorRecord: WorkflowErrorRecord,
  timestamp: Temporal.Instant,
  reason: "deadline" | "failed",
  deadlineAt?: Temporal.Instant,
): Promise<ExecutionResult<unknown>> {
  const failedRun = await patchRunIfCurrent(
    context.store,
    run,
    transitionRunToFailed(run, errorRecord, timestamp, reason, deadlineAt),
  );

  if (failedRun === undefined) {
    return await context.readResult(run.id);
  }

  const appendedEvents = await context.store.appendEventIfRunCurrent(failedRun, {
    kind: "workflow_failed",
    timestamp,
  });

  if (appendedEvents === undefined) {
    return await context.readResult(run.id);
  }

  await wakeParentRun(context.store, failedRun, timestamp);

  return {
    kind: "failed",
    run: failedRun,
    error: errorRecord,
  };
}

export const DEFAULT_RETRY_INTERVAL = Temporal.Duration.from({
  seconds: 30,
});

function deadlineErrorRecord(run: RunRecord, deadlineAt: Temporal.Instant): WorkflowErrorRecord {
  return toWorkerErrorRecord(new WorkflowRunDeadlineExceededError(run.id, deadlineAt));
}

export function retryDelay(
  retry: ResolvedMissingImplementationRetryConfig,
  retryAttempt: number,
): Temporal.Duration {
  if (!isPositiveSafeInteger(retryAttempt)) {
    throw new WorkflowOptionsError(
      "Workflow missing implementation retry delay attempt must be a positive safe integer",
      { code: WorkflowErrorCode.OPTIONS_MISSING_IMPLEMENTATION_RETRY_ATTEMPT_INVALID },
    );
  }

  const exponentialDelay =
    durationTotal(retry.initialInterval) *
    retry.backoffCoefficient ** Math.max(0, retryAttempt - 1);

  const delay =
    retry.maximumInterval === undefined
      ? exponentialDelay
      : Math.min(exponentialDelay, durationTotal(retry.maximumInterval));

  safeDuration(delay, "Workflow missing implementation retry delay");

  return Temporal.Duration.from({ milliseconds: delay });
}
