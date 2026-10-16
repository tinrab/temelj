import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { StepAttemptRecord } from "../types/step-attempts.ts";

import {
  isWorkflowTerminalStepAttemptEvent,
  getWorkflowEventStepAttemptKey,
} from "../events/descriptors.ts";
import { applyStepAttemptEvent } from "./projection.ts";

export function createStepAttempts(
  runId: RunId,
  events: readonly EventRecord[],
): readonly StepAttemptRecord[] {
  // Reconciliation rebuilds the materialized read model from append-only history. It skips
  // events that cannot be attached to a valid attempt instead of failing the whole rebuild.
  const attempts = new Map<string, StepAttemptRecord>();

  for (const event of events) {
    const key = reconciledStepAttemptKeyFromEvent(event);

    if (key === undefined) {
      continue;
    }

    const current = attempts.get(key);
    const attempt = applyReconciledStepAttemptEvent(runId, event, current);

    if (
      attempt === undefined ||
      (isWorkflowTerminalStepAttemptEvent(event) && !attempts.has(key))
    ) {
      continue;
    }

    attempts.set(key, attempt);
  }

  const normalizedAttempts = markSupersededRunningStepAttemptsAsAbandoned([...attempts.values()]);

  return normalizedAttempts.sort(compareStepAttempts);
}

function applyReconciledStepAttemptEvent(
  runId: RunId,
  event: EventRecord,
  current: StepAttemptRecord | undefined,
): StepAttemptRecord | undefined {
  try {
    return applyStepAttemptEvent(runId, event, current);
  } catch {
    return undefined;
  }
}

function reconciledStepAttemptKeyFromEvent(event: EventRecord): string | undefined {
  try {
    return getWorkflowEventStepAttemptKey(event);
  } catch {
    return undefined;
  }
}

function markSupersededRunningStepAttemptsAsAbandoned(
  attempts: readonly StepAttemptRecord[],
): StepAttemptRecord[] {
  // A later attempt for the same step means an earlier running attempt did not produce the
  // terminal event we expected. Marking it abandoned keeps dashboards from reporting it as live.
  const latestAttemptByStepId = new Map<string, number>();

  for (const attempt of attempts) {
    latestAttemptByStepId.set(
      attempt.stepId,
      Math.max(latestAttemptByStepId.get(attempt.stepId) ?? 0, attempt.attempt),
    );
  }

  return attempts.map((attempt) => {
    if (attempt.status !== "running") {
      return attempt;
    }

    const latestAttempt = latestAttemptByStepId.get(attempt.stepId) ?? attempt.attempt;

    if (attempt.attempt >= latestAttempt) {
      return attempt;
    }

    return {
      ...attempt,
      status: "abandoned",
    };
  });
}

function compareStepAttempts(left: StepAttemptRecord, right: StepAttemptRecord): number {
  const started = Temporal.Instant.compare(left.startedAt, right.startedAt);

  if (started !== 0) {
    return started;
  }

  const stepId = left.stepId.localeCompare(right.stepId);

  return stepId === 0 ? left.attempt - right.attempt : stepId;
}
