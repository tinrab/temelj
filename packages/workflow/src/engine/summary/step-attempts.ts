import type { MaterializedStepType, RunRecord } from "../../types/run.ts";
import type {
  NextAttempt,
  NextAttemptSleep,
  StepAttemptFailureErrorSummary,
  StepAttemptRecord,
  StepAttemptStatus,
  StepAttemptSummary,
} from "../../types/step-attempts.ts";

import { stepAttemptKey } from "../../store-keys.ts";
import { earliestOptionalTimestamp, latestOptionalTimestamp } from "../../temporal.ts";
import { summarizeChildRuns } from "./runs.ts";
import { Earliest, sorted, WaitTally } from "./tally.ts";

const STEP_ATTEMPT_STATUSES = [
  "running",
  "completed",
  "failed",
  "abandoned",
] as const satisfies readonly StepAttemptStatus[];

const STEP_TYPES = [
  "run",
  "sleep",
  "workflow",
  "message-send",
  "message-wait",
  "stream",
  "deterministic",
] as const satisfies readonly MaterializedStepType[];

/** Summarizes one run's step attempts, with the child runs its workflow steps started. */
export function summarizeStepAttempts(
  attempts: readonly StepAttemptRecord[],
  childRuns: readonly RunRecord[] = [],
): StepAttemptSummary {
  const byStatus = new Buckets(STEP_ATTEMPT_STATUSES);
  const byKind = new Buckets(STEP_TYPES);
  const failure = new StepFailureTally();
  const sleeps = { stepIds: new Set<string>(), attemptKeys: new Set<string>() };

  const nextSleep = new Earliest<Omit<NextAttemptSleep, "at">>();

  const messageWaits = new WaitTally<Omit<NextAttempt, "at">>();
  const messages = new Set<string>();
  const childWaits = new WaitTally<Omit<NextAttempt, "at">>();
  const childRunIds = new Set<string>();
  const workflows = new Set<string>();
  let oldestRunningAt: Temporal.Instant | undefined;
  let latestFinishedAt: Temporal.Instant | undefined;

  for (const attempt of attempts) {
    const attemptKey = stepAttemptKey(attempt.stepId, attempt.attempt);
    byStatus.add(attempt.status, attempt.stepId, attemptKey);
    byKind.add(attempt.kind, attempt.stepId, attemptKey);
    failure.add(attempt, attemptKey);
    latestFinishedAt = latestOptionalTimestamp(latestFinishedAt, attempt.finishedAt);

    if (attempt.status !== "running") {
      continue;
    }

    oldestRunningAt = earliestOptionalTimestamp(oldestRunningAt, attempt.startedAt);
    const next = { stepId: attempt.stepId, attemptKey };

    if (attempt.kind === "sleep") {
      sleeps.stepIds.add(attempt.stepId);
      sleeps.attemptKeys.add(attemptKey);
      nextSleep.offer(attempt.until, {
        ...next,
        duration: attempt.duration instanceof Temporal.Duration ? attempt.duration : undefined,
      });
    } else if (attempt.kind === "message-wait") {
      messageWaits.add(attempt.stepId, attemptKey, attempt.startedAt);
      messageWaits.next.offer(attempt.timeoutAt, next);

      if (attempt.messageId !== undefined) {
        messages.add(attempt.messageId);
      }
    } else if (attempt.kind === "workflow") {
      childWaits.add(attempt.stepId, attemptKey, attempt.startedAt);
      childWaits.next.offer(attempt.timeoutAt, next);

      if (attempt.childRunId !== undefined) {
        childRunIds.add(attempt.childRunId);
      }

      if (attempt.workflowName !== undefined) {
        workflows.add(
          attempt.workflowVersion === undefined
            ? attempt.workflowName
            : `${attempt.workflowName}@${attempt.workflowVersion}`,
        );
      }
    }
  }

  return {
    total: attempts.length,
    statusStepIds: byStatus.stepIds(),
    statusAttemptKeys: byStatus.attemptKeys(),
    kindStepIds: byKind.stepIds(),
    kindAttemptKeys: byKind.attemptKeys(),
    failure: failure.finish(),
    oldestRunningAt,
    latestFinishedAt,
    sleep:
      sleeps.stepIds.size === 0
        ? undefined
        : {
            stepIds: sorted(sleeps.stepIds),
            attemptKeys: sorted(sleeps.attemptKeys),
            next: nextSleep.next,
          },
    childWorkflow:
      childWaits.total === 0
        ? undefined
        : {
            stepIds: sorted(childWaits.stepIds),
            attemptKeys: sorted(childWaits.attemptKeys),
            childRunIds: sorted(childRunIds),
            workflows: sorted(workflows),
            ...summarizeChildRuns(childRuns.filter((run) => childRunIds.has(run.id))),
            oldestStartedAt: childWaits.oldestStartedAt,
            next: childWaits.next.next,
          },
    message:
      messageWaits.total === 0
        ? undefined
        : {
            stepIds: sorted(messageWaits.stepIds),
            attemptKeys: sorted(messageWaits.attemptKeys),
            messages: sorted(messages),
            oldestStartedAt: messageWaits.oldestStartedAt,
            next: messageWaits.next.next,
          },
  };
}

/** Step IDs and attempt keys grouped by status or by kind. */
class Buckets<TKey extends string> {
  readonly #keys: readonly TKey[];
  readonly #stepIds = new Map<TKey, string[]>();
  readonly #attemptKeys = new Map<TKey, string[]>();

  constructor(keys: readonly TKey[]) {
    this.#keys = keys;
  }

  add(key: TKey, stepId: string, attemptKey: string): void {
    push(this.#stepIds, key, stepId);
    push(this.#attemptKeys, key, attemptKey);
  }

  stepIds(): Record<TKey, readonly string[]> {
    return this.#sorted(this.#stepIds);
  }

  attemptKeys(): Record<TKey, readonly string[]> {
    return this.#sorted(this.#attemptKeys);
  }

  #sorted(lists: ReadonlyMap<TKey, readonly string[]>): Record<TKey, readonly string[]> {
    // SAFETY: Every key of the complete tuple gets a sorted list.
    return Object.fromEntries(
      this.#keys.map((key) => [key, sorted(lists.get(key) ?? [])]),
    ) as Record<TKey, readonly string[]>;
  }
}

function push<TKey>(lists: Map<TKey, string[]>, key: TKey, value: string): void {
  const list = lists.get(key);

  if (list === undefined) {
    lists.set(key, [value]);
  } else {
    list.push(value);
  }
}

interface StepErrorTally {
  latestFailedAt?: Temporal.Instant;
  readonly failedStepIds: Set<string>;
  readonly failedAttemptKeys: Set<string>;
}

/** Failed step attempts grouped by error name. */
class StepFailureTally {
  #latestFailedAt: Temporal.Instant | undefined;
  readonly #failedStepIds = new Set<string>();
  readonly #failedAttemptKeys = new Set<string>();
  readonly #errors = new Map<string, StepErrorTally>();

  add(attempt: StepAttemptRecord, attemptKey: string): void {
    if (attempt.status !== "failed") {
      return;
    }

    this.#failedStepIds.add(attempt.stepId);
    this.#failedAttemptKeys.add(attemptKey);
    this.#latestFailedAt = latestOptionalTimestamp(this.#latestFailedAt, attempt.finishedAt);

    const name = attempt.error?.name ?? "Error";

    const error = this.#errors.get(name) ?? {
      failedStepIds: new Set<string>(),
      failedAttemptKeys: new Set<string>(),
    };

    error.failedStepIds.add(attempt.stepId);
    error.failedAttemptKeys.add(attemptKey);
    error.latestFailedAt = latestOptionalTimestamp(error.latestFailedAt, attempt.finishedAt);
    this.#errors.set(name, error);
  }

  finish(): StepAttemptSummary["failure"] {
    if (this.#failedAttemptKeys.size === 0) {
      return undefined;
    }

    return {
      stepIds: sorted(this.#failedStepIds),
      attemptKeys: sorted(this.#failedAttemptKeys),
      errors: [...this.#errors.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, error]): StepAttemptFailureErrorSummary => ({
          name,
          stepIds: sorted(error.failedStepIds),
          attemptKeys: sorted(error.failedAttemptKeys),
          latestFailedAt: error.latestFailedAt,
        })),
      latestFailedAt: this.#latestFailedAt,
    };
  }
}
