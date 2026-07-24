import type { WorkflowExecutionEnvironment } from "../types/engine.ts";
import type {
  AcquireLockOptions,
  LockRecord,
  ReleaseLockOptions,
  WorkflowStepAcquireLockOptions,
  WorkflowStepReleaseLockOptions,
} from "../types/lock.ts";
import type {
  WorkflowStepContext,
  WorkflowStepLockApi,
  WorkflowStepRunConfig,
} from "../types/step.ts";
import type {
  WorkflowLockConditionalWriterRepository,
  WorkflowLockReaderRepository,
  WorkflowRunListerRepository,
  WorkflowRunUnconditionalWriterRepository,
  WorkflowStepAttemptLookup,
  WorkflowStoreNamespace,
} from "../types/store.ts";

import {
  WorkflowLockError,
  WorkflowLockStateError,
  WorkflowNonRetryableError,
  WorkflowOptionsError,
  WorkflowRetryableError,
} from "../errors/mod.ts";
import { isPositiveSafeInteger, positiveSafeInteger } from "../utility.ts";
import { recordWorkflowDeterministicValue } from "./deterministic.ts";
import {
  requireLockReplayMatches,
  requireLockReleaseReplayMatches,
  requireLockWaitDeadlineReplayMatches,
  requireLockWaitReplayMatches,
} from "./lock-replay.ts";
import { patchRun, WorkflowSuspended } from "./state.ts";

type WorkflowLockCommandStore = WorkflowStoreNamespace &
  WorkflowLockReaderRepository &
  WorkflowLockConditionalWriterRepository;

type WorkflowLockRunWakeStore = WorkflowRunListerRepository &
  WorkflowRunUnconditionalWriterRepository;

type WorkflowLockStepAttemptWakeStore = WorkflowStepAttemptLookup;

type WorkflowLockWakeStore = WorkflowLockRunWakeStore & WorkflowLockStepAttemptWakeStore;

type WorkflowLockReleaseStore = WorkflowLockCommandStore & WorkflowLockWakeStore;

export interface WorkflowStepLockEngine {
  acquireLock(key: string, options: AcquireLockOptions): Promise<LockRecord>;
  releaseLock(key: string, options: ReleaseLockOptions): Promise<LockRecord>;
}

type WorkflowStepLockRunner = <TOutput>(
  config: WorkflowStepRunConfig,
  callback: (context: WorkflowStepContext) => Promise<TOutput> | TOutput,
) => Promise<TOutput>;

export function createWorkflowStepLockApi(
  environment: WorkflowExecutionEnvironment,
  engine: WorkflowStepLockEngine,
  run: WorkflowStepLockRunner,
): WorkflowStepLockApi {
  const { runId, history } = environment;

  const acquire = async (
    commandId: string,
    key: string,
    options: WorkflowStepAcquireLockOptions,
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
        return await engine.acquireLock(key, {
          ...engineLockOptions,
          holderId: options.holderId ?? runId,
          holderRunId: runId,
          holderStepId: context.step.id,
          ...(waitDeadlineAt === undefined ? {} : { waitDeadlineAt }),
        });
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
    options?: WorkflowStepReleaseLockOptions,
  ): Promise<LockRecord> => {
    const holderId = options?.holderId ?? runId;
    const lock = await run({ commandId, retry: { maximumAttempts: 1 } }, async () => {
      return await engine.releaseLock(key, {
        holderId,
        ...(options?.now === undefined ? {} : { now: options.now }),
      });
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
      options: WorkflowStepAcquireLockOptions,
      callback: (lock: LockRecord) => Promise<TOutput> | TOutput,
    ): Promise<TOutput> {
      const lock = await acquire(`${commandId}:acquire`, key, options);
      try {
        const output = await callback(lock);
        await release(`${commandId}:release`, key, {
          ...(options.holderId === undefined ? {} : { holderId: options.holderId }),
          ...(options.now === undefined ? {} : { now: options.now }),
        });
        return output;
      } catch (error) {
        if (error instanceof WorkflowSuspended) {
          throw error;
        }
        await release(`${commandId}:release`, key, {
          ...(options.holderId === undefined ? {} : { holderId: options.holderId }),
          ...(options.now === undefined ? {} : { now: options.now }),
        });
        throw error;
      }
    },
  };
}

export async function acquireLock(
  store: WorkflowLockCommandStore,
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
        WorkflowNonRetryableError.failed(`Workflow lock wait timed out: ${key}`, {
          details: {
            key,
            holderId,
            currentHolderId: existing.holderId,
            waitDeadlineAt: waitDeadlineAt.toString(),
          },
        });
      }
      const retryAt = workflowLockRetryAt(existing, acquiredAt, waitDeadlineAt);
      throw WorkflowRetryableError.lockAlreadyHeld(key, {
        retryAt,
        details: {
          key,
          holderId,
          currentHolderId: existing.holderId,
          ...(waitDeadlineAt === undefined ? {} : { waitDeadlineAt: waitDeadlineAt.toString() }),
        },
      });
    }
    WorkflowLockError.alreadyHeld(key);
  }
  const lock: LockRecord = {
    key,
    namespace: store.namespace,
    holderId,
    ...(lockOptions.holderRunId === undefined ? {} : { holderRunId: lockOptions.holderRunId }),
    ...(lockOptions.holderStepId === undefined ? {} : { holderStepId: lockOptions.holderStepId }),
    fencingToken: (existing?.fencingToken ?? 0) + 1,
    acquiredAt,
    leaseExpiresAt: acquiredAt.add(Temporal.Duration.from({ milliseconds: leaseDuration })),
  };
  const acquired = await store.updateLockIfCurrent(existing, lock);
  if (acquired === undefined) {
    WorkflowLockStateError.acquireConflictExhausted(key);
  }
  return acquired;
}

export async function releaseLock(
  store: WorkflowLockReleaseStore,
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
    WorkflowLockError.holderMismatch(key);
  }
  const released = {
    ...current,
    releasedAt,
  };
  const updated = await store.updateLockIfCurrent(current, released);
  if (updated === undefined) {
    WorkflowLockStateError.releaseConflictExhausted(key);
  }
  await wakeWorkflowRunsWaitingForLock(store, key, releasedAt);
  return updated;
}

export async function releaseStaleLock(
  store: WorkflowLockReleaseStore,
  key: string,
  releasedAt: Temporal.Instant,
): Promise<LockRecord> {
  const current = await store.getLock(key);
  if (current === undefined) {
    WorkflowLockStateError.notFound(key);
  }
  if (current.releasedAt !== undefined) {
    WorkflowLockError.alreadyReleased(key);
  }
  if (Temporal.Instant.compare(current.leaseExpiresAt, releasedAt) > 0) {
    WorkflowLockError.notStale(key);
  }
  const released = {
    ...current,
    releasedAt,
  };
  const updated = await store.updateLockIfCurrent(current, released);
  if (updated === undefined) {
    WorkflowLockStateError.staleReleaseConflictExhausted(key);
  }
  await wakeWorkflowRunsWaitingForLock(store, key, releasedAt);
  return updated;
}

function resolveLockWaitDeadline(
  options: AcquireLockOptions,
  now: Temporal.Instant,
): Temporal.Instant | undefined {
  if (options.waitTimeout !== undefined && options.waitDeadlineAt !== undefined) {
    WorkflowLockError.waitDeadlineConflict();
  }
  if (
    (options.waitTimeout !== undefined || options.waitDeadlineAt !== undefined) &&
    options.wait !== true
  ) {
    WorkflowLockError.timeoutRequiresWait();
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
    WorkflowOptionsError.positiveSafeIntegerDuration(label);
  }
  return milliseconds;
}

async function recordLockWaitDeadline(
  environment: WorkflowExecutionEnvironment,
  name: string,
  timeout: Temporal.Duration,
): Promise<Temporal.Instant> {
  const resolvedTimeout = positiveSafeInteger(
    timeout.total({ unit: "millisecond" }),
    "Workflow lock waitTimeout",
  );
  return await recordWorkflowDeterministicValue(
    environment,
    `${name}:wait-deadline`,
    () => environment.now().add(Temporal.Duration.from({ milliseconds: resolvedTimeout })),
    (recorded) => requireLockWaitDeadlineReplayMatches(recorded, resolvedTimeout),
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

async function wakeWorkflowRunsWaitingForLock(
  store: WorkflowLockWakeStore,
  key: string,
  timestamp: Temporal.Instant,
): Promise<void> {
  const wakeAt = timestamp;
  const waitingRuns = await store.listRuns({ status: "waiting", retryReason: "step" });
  await Promise.all(
    waitingRuns.map(async (run) => {
      if (run.availableAt !== undefined && Temporal.Instant.compare(run.availableAt, wakeAt) <= 0) {
        return;
      }
      const attempts = await store.listStepAttempts(run.id, {
        kind: "run",
        status: "failed",
      });
      if (
        !attempts.some((attempt) => WorkflowRetryableError.isLockAlreadyHeld(attempt.error, key))
      ) {
        return;
      }
      await patchRun(store, run, {
        availableAt: wakeAt,
        retryAt: wakeAt,
        updatedAt: wakeAt,
        lastTransitionAt: wakeAt,
        lastTransitionReason: "retry",
        deadlineAt: run.deadlineAt,
        startedAt: run.startedAt ?? wakeAt,
        error: run.error,
        output: undefined,
        finishedAt: undefined,
      });
    }),
  );
}
