import type { EventRecord } from "../../types/events.ts";
import type { MessageId, RunId, StepId, StreamId } from "../../types/ids.ts";
import type { RunRecord, RunStatus, TerminalRunStatus } from "../../types/run.ts";
import type { StepAttemptRecord } from "../../types/step-attempts.ts";
import type { WorkflowStore } from "../../types/store.ts";
import type {
  NextSleep,
  NextStep,
  RunChildWorkflowSummary,
  RunFailureSummary,
  RunRetrySummary,
  RunSummary,
  RunWaitSummary,
  RunWorkflowCount,
} from "../../types/summary.ts";

import { isRunStatus, isScheduledRunStatus } from "../../run-status.ts";
import { runStepAttemptKey } from "../../store-keys.ts";
import { earliestOptionalTimestamp, latestOptionalTimestamp } from "../../temporal.ts";
import {
  counts,
  Earliest,
  FailureTally,
  RetryTally,
  RUN_STATUSES,
  RUN_TRANSITION_REASONS,
  sorted,
  sortedOrUndefined,
  TERMINAL_RUN_STATUSES,
  WaitTally,
} from "./tally.ts";

export interface RunAttemptsInput {
  readonly runId: RunId;
  readonly attempts: readonly StepAttemptRecord[];
}

export interface RunChildWorkflowWaitInput extends RunAttemptsInput {
  readonly childRuns: readonly RunRecord[];
}

export interface RunEventActivityInput {
  readonly runId: RunId;
  readonly events: readonly EventRecord[];
}

export interface RunSummaryInputs {
  readonly runs: readonly RunRecord[];
  readonly now: Temporal.Instant;
  readonly cleanupCutoff?: Temporal.Instant;
  readonly runningChildWorkflows?: readonly RunChildWorkflowWaitInput[];
  readonly runningSleeps?: readonly RunAttemptsInput[];
  readonly runningMessageWaits?: readonly RunAttemptsInput[];
  readonly runningEvents?: readonly RunEventActivityInput[];
}

/** Summarizes run records and their active waits for inspection dashboards. */
export function summarizeRuns(inputs: RunSummaryInputs): RunSummary {
  const states = new RunStateTally(inputs.now, inputs.cleanupCutoff);

  for (const run of inputs.runs) {
    states.add(run);
  }

  const streams = new WaitTally<object>();
  const streamNames = new Set<string>();
  let chunkCount = 0;
  const hooks = new WaitTally<Omit<NextStep, "at">>();
  const hookNames = new Set<string>();
  const webhookNames = new Set<string>();
  const hookMessages = new Set<string>();
  let webhooks = 0;

  for (const { runId, events } of inputs.runningEvents ?? []) {
    const active = activeEvents(events);

    for (const stream of active.streams) {
      streams.add(stream.stepId, undefined, stream.startedAt);
      streamNames.add(stream.stepName);
      chunkCount += stream.chunkCount;
    }

    for (const hook of active.hooks) {
      hooks.add(hook.stepId, undefined, hook.startedAt);
      hooks.next.offer(hook.timeoutAt, { runId, stepId: hook.stepId });
      hookMessages.add(hook.messageId);

      if (hook.source === "hook") {
        hookNames.add(hook.name);
      } else {
        webhooks++;
        webhookNames.add(hook.name);
      }
    }
  }

  const sleeps = new WaitTally<Omit<NextSleep, "at">>();

  for (const { runId, attempts } of inputs.runningSleeps ?? []) {
    for (const attempt of attempts) {
      sleeps.add(attempt.stepId, undefined, attempt.startedAt);
      sleeps.next.offer(attempt.until, {
        runId,
        stepId: attempt.stepId,
        attemptKey: runStepAttemptKey(runId, attempt),
        duration: attempt.duration instanceof Temporal.Duration ? attempt.duration : undefined,
      });
    }
  }

  const messageWaits = new WaitTally<Omit<NextStep, "at">>();
  const messages = new Set<string>();

  for (const { runId, attempts } of inputs.runningMessageWaits ?? []) {
    for (const attempt of attempts) {
      messageWaits.add(attempt.stepId, undefined, attempt.startedAt);
      messageWaits.next.offer(attempt.timeoutAt, {
        runId,
        stepId: attempt.stepId,
        attemptKey: runStepAttemptKey(runId, attempt),
      });

      if (attempt.messageId !== undefined) {
        messages.add(attempt.messageId);
      }
    }
  }

  return {
    ...states.finish(),
    stream:
      streams.total === 0
        ? undefined
        : { ...waitSummary(streams), names: sorted(streamNames), chunkCount },
    hook:
      hooks.total === 0
        ? undefined
        : {
            ...waitSummary(hooks),
            webhooks,
            hookNames: sorted(hookNames),
            webhookNames: sorted(webhookNames),
            messages: sorted(hookMessages),
            next: hooks.next.next,
          },
    sleep: sleeps.total === 0 ? undefined : { ...waitSummary(sleeps), next: sleeps.next.next },
    message:
      messageWaits.total === 0
        ? undefined
        : {
            ...waitSummary(messageWaits),
            messages: sorted(messages),
            next: messageWaits.next.next,
          },
    childWorkflow: summarizeChildWorkflowWaits(inputs.runningChildWorkflows ?? []),
  };
}

/** Child runs that belong to the given child-workflow step attempts of a parent run. */
export async function getChildRunsForAttempts(
  store: WorkflowStore,
  parentRunId: RunId,
  attempts: readonly StepAttemptRecord[],
): Promise<readonly RunRecord[]> {
  const childRunIds = new Set(attempts.flatMap((attempt) => attempt.childRunId ?? []));

  const childRuns = await Promise.all([...childRunIds].map((runId) => store.getRun(runId)));

  return childRuns.filter(
    (run): run is RunRecord =>
      run !== undefined &&
      attempts.some(
        (attempt) =>
          run.parentRunId === parentRunId &&
          run.parentStepId === attempt.stepId &&
          run.parentStepName === attempt.stepName &&
          run.parentStepAttempt === attempt.attempt &&
          attempt.childRunId === run.id &&
          attempt.workflowName === run.workflowName &&
          attempt.workflowVersion === run.workflowVersion,
      ),
  );
}

function waitSummary(waits: WaitTally<object>): RunWaitSummary {
  return { count: waits.total, oldestStartedAt: waits.oldestStartedAt };
}

interface LeaseTally {
  count: number;
  expired: number;
  oldestExpiredAt?: Temporal.Instant;
  readonly workerIds: Set<string>;
  readonly next: Earliest<{ readonly runId: RunId }>;
}

interface CleanupTally {
  oldestFinishedAt?: Temporal.Instant;
  newestFinishedAt?: Temporal.Instant;
  readonly status: Record<TerminalRunStatus, number>;
}

type RunStateSummary = Omit<RunSummary, "stream" | "hook" | "sleep" | "message" | "childWorkflow">;

/** Everything a summary reads from the run records themselves. */
class RunStateTally {
  readonly #now: Temporal.Instant;
  readonly #cleanupCutoff: Temporal.Instant | undefined;
  #total = 0;
  readonly #status = counts(RUN_STATUSES);
  readonly #workflows = new Map<string, RunWorkflowCount>();
  readonly #transitionReason = counts(RUN_TRANSITION_REASONS);
  #latestTransitionAt: Temporal.Instant | undefined;
  readonly #retry = new RetryTally();
  readonly #failure = new FailureTally();
  readonly #lease: LeaseTally = {
    count: 0,
    expired: 0,
    workerIds: new Set<string>(),
    next: new Earliest<{ readonly runId: RunId }>(),
  };
  readonly #cleanup: CleanupTally = { status: counts(TERMINAL_RUN_STATUSES) };
  #nextAvailableAt: Temporal.Instant | undefined;
  #oldestPendingAt: Temporal.Instant | undefined;
  #oldestRunningAt: Temporal.Instant | undefined;

  constructor(now: Temporal.Instant, cleanupCutoff: Temporal.Instant | undefined) {
    this.#now = now;
    this.#cleanupCutoff = cleanupCutoff;
  }

  add(run: RunRecord): void {
    if (!isRunStatus(run.status)) {
      return;
    }

    this.#total++;
    this.#status[run.status]++;
    this.#addWorkflow(run);
    this.#transitionReason[run.lastTransitionReason]++;
    this.#latestTransitionAt = latestOptionalTimestamp(
      this.#latestTransitionAt,
      run.lastTransitionAt,
    );
    this.#retry.add(run);
    this.#failure.add(run);
    this.#addLease(run);
    this.#addCleanup(run, run.status);

    if (isScheduledRunStatus(run.status)) {
      this.#nextAvailableAt = earliestOptionalTimestamp(this.#nextAvailableAt, run.availableAt);
      this.#oldestPendingAt = earliestOptionalTimestamp(this.#oldestPendingAt, run.createdAt);
    }

    if (run.status === "running") {
      this.#oldestRunningAt = earliestOptionalTimestamp(
        this.#oldestRunningAt,
        run.startedAt ?? run.createdAt,
      );
    }
  }

  finish(): RunStateSummary {
    const lease = this.#lease;
    const cleanup = this.#cleanup;

    return {
      total: this.#total,
      status: this.#status,
      workflows: [...this.#workflows.values()].sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          (left.version ?? "").localeCompare(right.version ?? ""),
      ),
      transition: {
        reason: this.#transitionReason,
        latestTransitionAt: this.#latestTransitionAt,
      },
      retry: this.#retry.finish(),
      failure: this.#failure.total === 0 ? undefined : this.#failure.finish(),
      lease: {
        count: lease.count,
        expired: lease.expired,
        workerIds: sorted(lease.workerIds),
        oldestExpiredAt: lease.oldestExpiredAt,
        next: lease.next.next,
      },
      cleanup:
        this.#cleanupCutoff === undefined
          ? undefined
          : {
              status: cleanup.status,
              oldestFinishedAt: cleanup.oldestFinishedAt,
              newestFinishedAt: cleanup.newestFinishedAt,
            },
      nextAvailableAt: this.#nextAvailableAt,
      oldestPendingAt: this.#oldestPendingAt,
      oldestRunningAt: this.#oldestRunningAt,
    };
  }

  #addWorkflow(run: RunRecord): void {
    const key =
      run.workflowVersion === undefined
        ? run.workflowName
        : `${run.workflowName}\0${run.workflowVersion}`;

    const entry = this.#workflows.get(key);

    this.#workflows.set(key, {
      name: run.workflowName,
      version: run.workflowVersion,
      count: (entry?.count ?? 0) + 1,
    });
  }

  #addLease(run: RunRecord): void {
    if (run.status !== "running") {
      return;
    }

    const lease = this.#lease;
    lease.count++;

    if (run.workerId !== undefined) {
      lease.workerIds.add(run.workerId);
    }

    if (run.workerId === undefined || run.leaseExpiresAt === undefined) {
      lease.expired++;
    } else if (Temporal.Instant.compare(run.leaseExpiresAt, this.#now) <= 0) {
      lease.expired++;
      lease.oldestExpiredAt = earliestOptionalTimestamp(lease.oldestExpiredAt, run.leaseExpiresAt);
    } else {
      lease.next.offer(run.leaseExpiresAt, { runId: run.id });
    }
  }

  #addCleanup(run: RunRecord, status: RunStatus): void {
    const cutoff = this.#cleanupCutoff;

    if (
      cutoff === undefined ||
      (status !== "completed" && status !== "failed" && status !== "canceled") ||
      run.finishedAt === undefined ||
      Temporal.Instant.compare(run.finishedAt, cutoff) >= 0
    ) {
      return;
    }

    const cleanup = this.#cleanup;
    cleanup.status[status]++;
    cleanup.oldestFinishedAt = earliestOptionalTimestamp(cleanup.oldestFinishedAt, run.finishedAt);
    cleanup.newestFinishedAt = latestOptionalTimestamp(cleanup.newestFinishedAt, run.finishedAt);
  }
}

function summarizeChildWorkflowWaits(
  inputs: readonly RunChildWorkflowWaitInput[],
): RunChildWorkflowSummary | undefined {
  const waits = new WaitTally<Omit<NextStep, "at">>();
  const workflows = new Set<string>();
  const childRuns = new Map<string, RunRecord>();

  for (const { runId, attempts, childRuns: runs } of inputs) {
    for (const attempt of attempts) {
      waits.add(attempt.stepId, undefined, attempt.startedAt);
      waits.next.offer(attempt.timeoutAt, {
        runId,
        stepId: attempt.stepId,
        attemptKey: runStepAttemptKey(runId, attempt),
      });

      if (attempt.workflowName !== undefined) {
        workflows.add(
          attempt.workflowVersion === undefined
            ? attempt.workflowName
            : `${attempt.workflowName}@${attempt.workflowVersion}`,
        );
      }
    }

    for (const run of runs) {
      childRuns.set(run.id, run);
    }
  }

  if (waits.total === 0) {
    return undefined;
  }

  const { childStatus, childRetry, childFailure } = summarizeChildRuns([...childRuns.values()]);

  return {
    ...waitSummary(waits),
    workflows: sorted(workflows),
    childStatus,
    childRetry,
    childFailure,
    next: waits.next.next,
  };
}

interface ChildRunsSummary {
  readonly childStatus: Record<RunStatus, number>;
  readonly retryChildRunIds?: readonly string[];
  readonly failedChildRunIds?: readonly string[];
  readonly canceledChildRunIds?: readonly string[];
  readonly childRetry?: RunRetrySummary;
  readonly childFailure?: RunFailureSummary;
}

/** The state of the child runs that active child-workflow waits point at. */
export function summarizeChildRuns(runs: readonly RunRecord[]): ChildRunsSummary {
  const childStatus = counts(RUN_STATUSES);
  const retry = new RetryTally();
  const failure = new FailureTally();
  const failedChildRunIds = new Set<string>();
  const canceledChildRunIds = new Set<string>();

  for (const run of runs) {
    if (!isRunStatus(run.status)) {
      continue;
    }

    childStatus[run.status]++;
    retry.add(run);
    failure.add(run);

    if (run.status === "failed") {
      failedChildRunIds.add(run.id);
    } else if (run.status === "canceled") {
      canceledChildRunIds.add(run.id);
    }
  }

  return {
    childStatus,
    retryChildRunIds: retry.runIds(),
    failedChildRunIds: sortedOrUndefined(failedChildRunIds),
    canceledChildRunIds: sortedOrUndefined(canceledChildRunIds),
    childRetry: retry.total === 0 ? undefined : retry.finish(),
    childFailure: failure.total === 0 ? undefined : failure.finish(),
  };
}

interface ActiveStream {
  readonly stepId: StepId;
  readonly stepName: string;
  readonly streamId: StreamId;
  readonly startedAt: Temporal.Instant;
  readonly chunkCount: number;
}

interface ActiveHook {
  readonly stepId: StepId;
  readonly name: string;
  readonly messageId: MessageId;
  readonly source: "hook" | "webhook";
  readonly startedAt: Temporal.Instant;
  readonly timeoutAt?: Temporal.Instant;
}

interface ActiveEvents {
  readonly streams: readonly ActiveStream[];
  readonly hooks: readonly ActiveHook[];
}

/** Streams and hooks of one run that have started and not yet ended. */
function activeEvents(events: readonly EventRecord[]): ActiveEvents {
  const streams = new Map<string, ActiveStream>();
  const hooks = new Map<string, ActiveHook>();
  const ended = new Set<string>();

  for (const event of events) {
    switch (event.kind) {
      case "stream_started":
        streams.set(event.stepId, {
          stepId: event.stepId,
          stepName: event.stepName,
          streamId: event.streamId,
          startedAt: event.timestamp,
          chunkCount: 0,
        });
        break;
      case "stream_chunk": {
        const stream = streams.get(event.stepId);

        if (stream !== undefined) {
          streams.set(event.stepId, { ...stream, chunkCount: stream.chunkCount + 1 });
        }

        break;
      }

      case "message_wait_started":
        if (event.source === "hook" || event.source === "webhook") {
          hooks.set(event.stepId, {
            stepId: event.stepId,
            name: event.stepName,
            messageId: event.messageId,
            source: event.source,
            startedAt: event.timestamp,
            timeoutAt: event.timeoutAt,
          });
        }

        break;
      case "stream_closed":
      case "stream_failed":
      case "message_wait_completed":
      case "message_wait_failed":
        ended.add(`${event.kind.startsWith("stream") ? "stream" : "hook"}:${event.stepId}`);
        break;
      default:
        break;
    }
  }

  return {
    streams: [...streams.values()].filter((stream) => !ended.has(`stream:${stream.stepId}`)),
    hooks: [...hooks.values()].filter((hook) => !ended.has(`hook:${hook.stepId}`)),
  };
}
