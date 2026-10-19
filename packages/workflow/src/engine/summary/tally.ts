import type { RunId } from "../../types/ids.ts";
import type {
  RunRecord,
  RunRetryReason,
  RunStatus,
  RunTransitionReason,
  TerminalRunStatus,
} from "../../types/run.ts";
import type {
  RunFailureErrorSummary,
  RunFailureSummary,
  RunRetrySummary,
} from "../../types/summary.ts";

import { isScheduledRunStatus } from "../../run-status.ts";
import { earliestOptionalTimestamp, latestOptionalTimestamp } from "../../temporal.ts";
import { greatestOptionalNumber } from "../../values.ts";

export const RUN_STATUSES = [
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "canceled",
] as const satisfies readonly RunStatus[];

export const TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "canceled",
] as const satisfies readonly TerminalRunStatus[];

export const RUN_TRANSITION_REASONS = [
  "created",
  "claimed",
  "reclaimed",
  "started",
  "waiting",
  "rescheduled",
  "lease_released",
  "manual_retry",
  "permanent_failure",
  "retry",
  "missing_implementation",
  "completed",
  "failed",
  "deadline",
  "canceled",
] as const satisfies readonly RunTransitionReason[];

const RUN_RETRY_REASONS = [
  "workflow",
  "step",
  "missing_implementation",
] as const satisfies readonly RunRetryReason[];

/** Keeps the entry with the earliest instant. Ties keep the first entry. */
export class Earliest<T extends object> {
  #next: (T & { readonly at: Temporal.Instant }) | undefined;

  get at(): Temporal.Instant | undefined {
    return this.#next?.at;
  }

  get next(): (T & { readonly at: Temporal.Instant }) | undefined {
    return this.#next;
  }

  offer(at: Temporal.Instant | undefined, value: T): void {
    if (
      at !== undefined &&
      (this.#next === undefined || Temporal.Instant.compare(at, this.#next.at) < 0)
    ) {
      this.#next = { ...value, at };
    }
  }
}

export function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort();
}

/** Sorted values, or `undefined` when there are none. */
export function sortedOrUndefined(values: ReadonlySet<string>): readonly string[] | undefined {
  return values.size === 0 ? undefined : sorted(values);
}

export function counts<const TKey extends string>(keys: readonly TKey[]): Record<TKey, number> {
  // SAFETY: Every key of the complete tuple gets a zero entry.
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<TKey, number>;
}

/** Runs scheduled for a retry: why, which steps, and which retry comes next. */
export class RetryTally {
  #highestAttempt: number | undefined;
  readonly #next = new Earliest<{ readonly runId: RunId }>();
  readonly #reason = counts(RUN_RETRY_REASONS);
  readonly #runIds = new Set<string>();
  readonly #stepNames = new Set<string>();

  get total(): number {
    return this.#runIds.size;
  }

  add(run: RunRecord): void {
    if (!isScheduledRunStatus(run.status) || run.retryReason === undefined) {
      return;
    }

    this.#runIds.add(run.id);
    this.#reason[run.retryReason]++;

    if (run.retryStepName !== undefined) {
      this.#stepNames.add(run.retryStepName);
    }

    this.#highestAttempt = greatestOptionalNumber(this.#highestAttempt, run.retryAttempt);
    this.#next.offer(run.retryAt, { runId: run.id });
  }

  runIds(): readonly string[] | undefined {
    return sortedOrUndefined(this.#runIds);
  }

  finish(): RunRetrySummary {
    return {
      count: this.#runIds.size,
      stepNames: sorted(this.#stepNames),
      reason: this.#reason,
      highestAttempt: this.#highestAttempt,
      next: this.#next.next,
    };
  }
}

interface ErrorTally {
  latestFailedAt?: Temporal.Instant;
  readonly failedRunIds: Set<string>;
}

/** Failed runs grouped by error name. */
export class FailureTally {
  #latestFailedAt: Temporal.Instant | undefined;
  readonly #failedRunIds = new Set<string>();
  readonly #errors = new Map<string, ErrorTally>();

  get total(): number {
    return this.#failedRunIds.size;
  }

  add(run: RunRecord): void {
    if (run.status !== "failed") {
      return;
    }

    this.#failedRunIds.add(run.id);
    this.#latestFailedAt = latestOptionalTimestamp(this.#latestFailedAt, run.finishedAt);

    const name = run.error?.name ?? "Error";
    const error = this.#errors.get(name) ?? { failedRunIds: new Set<string>() };
    error.failedRunIds.add(run.id);
    error.latestFailedAt = latestOptionalTimestamp(error.latestFailedAt, run.finishedAt);
    this.#errors.set(name, error);
  }

  finish(): RunFailureSummary {
    return {
      count: this.#failedRunIds.size,
      errors: [...this.#errors.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, error]): RunFailureErrorSummary => ({
          name,
          count: error.failedRunIds.size,
          latestFailedAt: error.latestFailedAt,
        })),
      latestFailedAt: this.#latestFailedAt,
    };
  }
}

/** Waits of one kind across runs: who waits, since when, and which wait ends first. */
export class WaitTally<TNext extends object> {
  total = 0;
  oldestStartedAt: Temporal.Instant | undefined;
  readonly next = new Earliest<TNext>();
  readonly stepIds = new Set<string>();
  readonly attemptKeys = new Set<string>();

  add(
    stepId: string,
    attemptKey: string | undefined,
    startedAt: Temporal.Instant | undefined,
  ): void {
    this.total++;
    this.stepIds.add(stepId);

    if (attemptKey !== undefined) {
      this.attemptKeys.add(attemptKey);
    }

    this.oldestStartedAt = earliestOptionalTimestamp(this.oldestStartedAt, startedAt);
  }
}
