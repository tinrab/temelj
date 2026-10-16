import type { ExecutionEnvironment } from "../types/engine.ts";
import type { ErrorDetails } from "../types/error.ts";
import type {
  AcquireLockOptions,
  LockRecord,
  ReleaseLockOptions,
  StepAcquireLockOptions,
  StepReleaseLockOptions,
} from "../types/lock.ts";
import type { WorkflowStepContext, StepLockApi, StepRunConfig } from "../types/step.ts";
import type { WorkflowStore } from "../types/store.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import {
  WorkflowLockError,
  WorkflowLockStateError,
  WorkflowNonRetryableError,
  WorkflowOptionsError,
  WorkflowRetryableError,
  matchesWorkflowError,
} from "../errors/mod.ts";
import { isPositiveSafeInteger, positiveSafeInteger } from "../values.ts";
import { recordDeterministicValue } from "./deterministic.ts";
import {
  requireLockReplayMatches,
  requireLockReleaseReplayMatches,
  parseLockWaitDeadlineReplay,
  requireLockWaitReplayMatches,
} from "./lock-replay.ts";
import { Suspended } from "./signals.ts";
import { patchRun } from "./state.ts";

interface StepLockEngine {
  acquireLock(key: string, options: AcquireLockOptions): Promise<LockRecord>;
  releaseLock(key: string, options: ReleaseLockOptions): Promise<LockRecord>;
}

type StepLockRunner = <TOutput>(
  config: StepRunConfig,
  callback: (context: WorkflowStepContext) => Promise<TOutput> | TOutput,
) => Promise<TOutput>;

export function createStepLockApi(
  environment: ExecutionEnvironment,
  engine: StepLockEngine,
  run: StepLockRunner,
): StepLockApi {
  const { runId, history } = environment;

  const acquire = async (
    commandId: string,
    key: string,
    options: StepAcquireLockOptions,
  ): Promise<LockRecord> => {
    const requestedLeaseDuration = positiveSafeInteger(
      options.leaseDuration.total({ unit: "millisecond" }),
      "Workflow lock lease duration",
    );

    const waitDeadlineAt =
      options.waitTimeout === undefined
        ? undefined
        : await recordLockWaitDeadline(environment, commandId, options.waitTimeout);

    const { waitTimeout: _waitTimeout, ...engineLockOptions } = options;

    const lock = await run(
      { commandId, retry: { maximumAttempts: options.wait === true ? 0 : 1 } },
      async (context) => {
        const acquireOptions: AcquireLockOptions = {
          ...engineLockOptions,
          holderId: options.holderId ?? runId,
          holderRunId: runId,
          holderStepId: context.step.id,
          waitDeadlineAt,
        };

        return await engine.acquireLock(key, acquireOptions);
      },
    );

    requireLockReplayMatches(lock, {
      key,
      holderId: options.holderId ?? runId,
      holderRunId: runId,
      leaseDuration: requestedLeaseDuration,
    });
    requireLockWaitReplayMatches(history.failedSteps(`run:${commandId}`), {
      key,
      wait: options.wait === true,
    });

    return lock;
  };

  const release = async (
    commandId: string,
    key: string,
    options?: StepReleaseLockOptions,
  ): Promise<LockRecord> => {
    const holderId = options?.holderId ?? runId;

    const lock = await run({ commandId, retry: { maximumAttempts: 1 } }, async () => {
      const releaseOptions: ReleaseLockOptions = {
        holderId,
        now: options?.now,
      };

      return await engine.releaseLock(key, releaseOptions);
    });

    requireLockReleaseReplayMatches(lock, {
      key,
      holderId,
    });

    return lock;
  };

  return {
    acquire,
    release,

    async with<TOutput>(
      commandId: string,
      key: string,
      options: StepAcquireLockOptions,
      callback: (lock: LockRecord) => Promise<TOutput> | TOutput,
    ): Promise<TOutput> {
      const lock = await acquire(`${commandId}:acquire`, key, options);

      try {
        const output = await callback(lock);

        const releaseOptions: StepReleaseLockOptions = {
          holderId: options.holderId,
          now: options.now,
        };

        await release(`${commandId}:release`, key, releaseOptions);

        return output;
      } catch (error) {
        if (error instanceof Suspended) {
          throw error;
        }

        const releaseOptions: StepReleaseLockOptions = {
          holderId: options.holderId,
          now: options.now,
        };

        await release(`${commandId}:release`, key, releaseOptions);
        throw error;
      }
    },
  };
}

export async function acquireLock(
  store: WorkflowStore,
  key: string,
  lockOptions: AcquireLockOptions,
  acquiredAt: Temporal.Instant,
): Promise<LockRecord> {
  const holderId = lockOptions.holderId;

  const leaseDuration = positiveDurationMilliseconds(
    lockOptions.leaseDuration,
    "Workflow lock lease duration",
  );

  const waitDeadlineAt = resolveLockWaitDeadline(lockOptions, acquiredAt);
  const existing = await store.getLock(key);

  if (
    existing !== undefined &&
    !(existing.holderId === holderId || existing.releasedAt !== undefined) &&
    Temporal.Instant.compare(existing.leaseExpiresAt, acquiredAt) > 0
  ) {
    if (lockOptions.wait === true) {
      if (
        waitDeadlineAt !== undefined &&
        Temporal.Instant.compare(waitDeadlineAt, acquiredAt) <= 0
      ) {
        throw new WorkflowNonRetryableError(`Workflow lock wait timed out: ${key}`, {
          details: {
            key,
            holderId,
            currentHolderId: existing.holderId,
            waitDeadlineAt: waitDeadlineAt.toString(),
          },
        });
      }

      const retryAt = workflowLockRetryAt(existing, acquiredAt, waitDeadlineAt);

      const details: ErrorDetails = {
        key,
        holderId,
        currentHolderId: existing.holderId,
        waitDeadlineAt: waitDeadlineAt !== undefined ? waitDeadlineAt.toString() : undefined,
      };

      throw new WorkflowRetryableError(`Workflow lock is already held: ${key}`, {
        retryAt,
        code: WorkflowErrorCode.LOCK_ALREADY_HELD,
        details: { ...details, key },
      });
    }

    throw new WorkflowLockError(
      `Workflow lock is already held: ${key}`,
      WorkflowErrorCode.LOCK_ALREADY_HELD_WITHOUT_WAIT,
      { key: key },
    );
  }

  const lock: LockRecord = {
    key,
    namespace: store.namespace,
    holderId,
    holderRunId: lockOptions.holderRunId,
    holderStepId: lockOptions.holderStepId,
    fencingToken: (existing?.fencingToken ?? 0) + 1,
    acquiredAt,
    leaseExpiresAt: acquiredAt.add(Temporal.Duration.from({ milliseconds: leaseDuration })),
  };

  const acquired = await store.updateLockIfCurrent(existing, lock);

  if (acquired === undefined) {
    throw new WorkflowLockStateError(
      `Failed to acquire workflow lock ${key}`,
      WorkflowErrorCode.LOCK_ACQUIRE_CONFLICT_EXHAUSTED,
      { key: key },
    );
  }

  return acquired;
}

export async function releaseLock(
  store: WorkflowStore,
  key: string,
  lockOptions: ReleaseLockOptions,
  releasedAt: Temporal.Instant,
): Promise<LockRecord> {
  const holderId = lockOptions.holderId;
  const current = await store.getLock(key);

  if (current === undefined) {
    WorkflowLockStateError.notFound(key);
  }

  if (current.holderId !== holderId) {
    throw new WorkflowLockError(
      `Workflow lock holder mismatch: ${key}`,
      WorkflowErrorCode.LOCK_HOLDER_MISMATCH,
      { key: key },
    );
  }

  const released = {
    ...current,
    releasedAt,
  };

  const updated = await store.updateLockIfCurrent(current, released);

  if (updated === undefined) {
    throw new WorkflowLockStateError(
      `Failed to release workflow lock ${key}`,
      WorkflowErrorCode.LOCK_RELEASE_CONFLICT_EXHAUSTED,
      { key: key },
    );
  }

  await wakeRunsWaitingForLock(store, key, releasedAt);

  return updated;
}

export async function releaseStaleLock(
  store: WorkflowStore,
  key: string,
  releasedAt: Temporal.Instant,
): Promise<LockRecord> {
  const current = await store.getLock(key);

  if (current === undefined) {
    WorkflowLockStateError.notFound(key);
  }

  if (current.releasedAt !== undefined) {
    throw new WorkflowLockError(
      `Workflow lock is already released: ${key}`,
      WorkflowErrorCode.LOCK_ALREADY_RELEASED,
      { key: key },
    );
  }

  if (Temporal.Instant.compare(current.leaseExpiresAt, releasedAt) > 0) {
    throw new WorkflowLockError(
      `Workflow lock is not stale: ${key}`,
      WorkflowErrorCode.LOCK_NOT_STALE,
      { key: key },
    );
  }

  const released = {
    ...current,
    releasedAt,
  };

  const updated = await store.updateLockIfCurrent(current, released);

  if (updated === undefined) {
    throw new WorkflowLockStateError(
      `Failed to release stale workflow lock ${key}`,
      WorkflowErrorCode.LOCK_STALE_RELEASE_CONFLICT_EXHAUSTED,
      { key: key },
    );
  }

  await wakeRunsWaitingForLock(store, key, releasedAt);

  return updated;
}

function resolveLockWaitDeadline(
  options: AcquireLockOptions,
  now: Temporal.Instant,
): Temporal.Instant | undefined {
  if (options.waitTimeout !== undefined && options.waitDeadlineAt !== undefined) {
    throw new WorkflowLockError(
      "Workflow lock options cannot include both waitTimeout and waitDeadlineAt",
      WorkflowErrorCode.LOCK_WAIT_DEADLINE_CONFLICT,
      undefined,
    );
  }

  if (
    (options.waitTimeout !== undefined || options.waitDeadlineAt !== undefined) &&
    options.wait !== true
  ) {
    throw new WorkflowLockError(
      "Workflow lock timeout options require wait: true",
      WorkflowErrorCode.LOCK_TIMEOUT_REQUIRES_WAIT,
      undefined,
    );
  }

  if (options.waitDeadlineAt !== undefined) {
    return options.waitDeadlineAt;
  }

  if (options.waitTimeout === undefined) {
    return undefined;
  }

  positiveDurationMilliseconds(options.waitTimeout, "Workflow lock waitTimeout");

  return now.add(options.waitTimeout);
}

function positiveDurationMilliseconds(duration: Temporal.Duration, label: string): number {
  const milliseconds = duration.total({ unit: "millisecond" });

  if (!isPositiveSafeInteger(milliseconds)) {
    throw new WorkflowOptionsError(`${label} must be a positive safe integer duration`, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_POSITIVE_SAFE_INTEGER_DURATION,
      details: { label: label },
    });
  }

  return milliseconds;
}

async function recordLockWaitDeadline(
  environment: ExecutionEnvironment,
  name: string,
  timeout: Temporal.Duration,
): Promise<Temporal.Instant> {
  const resolvedTimeout = positiveSafeInteger(
    timeout.total({ unit: "millisecond" }),
    "Workflow lock waitTimeout",
  );

  return await recordDeterministicValue(
    environment,
    `${name}:wait-deadline`,
    () => environment.now().add(Temporal.Duration.from({ milliseconds: resolvedTimeout })),
    (recorded) => parseLockWaitDeadlineReplay(recorded, resolvedTimeout),
  );
}

function workflowLockRetryAt(
  lock: LockRecord,
  now: Temporal.Instant,
  waitDeadlineAt: Temporal.Instant | undefined,
): Temporal.Instant {
  const retryAt =
    Temporal.Instant.compare(lock.leaseExpiresAt, now) <= 0 ? now : lock.leaseExpiresAt;

  if (waitDeadlineAt !== undefined && Temporal.Instant.compare(waitDeadlineAt, retryAt) < 0) {
    return waitDeadlineAt;
  }

  return retryAt;
}

async function wakeRunsWaitingForLock(
  store: WorkflowStore,
  key: string,
  timestamp: Temporal.Instant,
): Promise<void> {
  const waitingRuns = await store.listRuns({ status: "waiting", retryReason: "step" });
  await Promise.all(
    waitingRuns.map(async (run) => {
      if (
        run.availableAt !== undefined &&
        Temporal.Instant.compare(run.availableAt, timestamp) <= 0
      ) {
        return;
      }

      const attempts = await store.listStepAttempts(run.id, {
        kind: "run",
        status: "failed",
      });

      if (
        !attempts.some((attempt) =>
          matchesWorkflowError(attempt.error, WorkflowErrorCode.LOCK_ALREADY_HELD, { key }),
        )
      ) {
        return;
      }

      await patchRun(store, run, {
        availableAt: timestamp,
        retryAt: timestamp,
        updatedAt: timestamp,
        lastTransitionAt: timestamp,
        lastTransitionReason: "retry",
        deadlineAt: run.deadlineAt,
        startedAt: run.startedAt ?? timestamp,
        error: run.error,
        output: undefined,
        finishedAt: undefined,
      });
    }),
  );
}
