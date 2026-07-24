import type { WorkflowRunRecord } from "../../types/run.ts";

import { earliestOptionalTimestamp } from "../../temporal.ts";
import { isScheduledWorkflowRunStatus } from "../../utility.ts";

export interface WorkflowRunAvailabilitySummaryFields {
  readonly nextAvailableAt?: Temporal.Instant;
  readonly oldestPendingAt?: Temporal.Instant;
  readonly oldestRunningAt?: Temporal.Instant;
}

interface WorkflowRunAvailabilityAccumulator {
  nextAvailableAt?: Temporal.Instant;
  oldestPendingAt?: Temporal.Instant;
  oldestRunningAt?: Temporal.Instant;
}

export function createWorkflowRunAvailabilitySummaryReducer(): {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunAvailabilitySummaryFields;
} {
  const availability = createWorkflowRunAvailabilityAccumulator();

  return {
    addRun(run) {
      addWorkflowRunAvailability(availability, run);
    },
    finish() {
      return finishWorkflowRunAvailabilitySummary(availability);
    },
  };
}

function createWorkflowRunAvailabilityAccumulator(): WorkflowRunAvailabilityAccumulator {
  return {};
}

function addWorkflowRunAvailability(
  availability: WorkflowRunAvailabilityAccumulator,
  run: WorkflowRunRecord,
): void {
  if (isScheduledWorkflowRunStatus(run.status)) {
    setWorkflowRunAvailabilityScheduled(availability, run);
  }
  if (run.status === "running") {
    setWorkflowRunAvailabilityRunning(availability, run);
  }
}

function setWorkflowRunAvailabilityScheduled(
  availability: WorkflowRunAvailabilityAccumulator,
  run: WorkflowRunRecord,
): void {
  availability.nextAvailableAt = earliestOptionalTimestamp(
    availability.nextAvailableAt,
    run.availableAt,
  );
  availability.oldestPendingAt = earliestOptionalTimestamp(
    availability.oldestPendingAt,
    run.createdAt,
  );
}

function setWorkflowRunAvailabilityRunning(
  availability: WorkflowRunAvailabilityAccumulator,
  run: WorkflowRunRecord,
): void {
  availability.oldestRunningAt = earliestOptionalTimestamp(
    availability.oldestRunningAt,
    run.startedAt ?? run.createdAt,
  );
}

function finishWorkflowRunAvailabilitySummary(
  availability: WorkflowRunAvailabilityAccumulator,
): WorkflowRunAvailabilitySummaryFields {
  return {
    ...(availability.nextAvailableAt === undefined
      ? {}
      : { nextAvailableAt: availability.nextAvailableAt }),
    ...(availability.oldestPendingAt === undefined
      ? {}
      : { oldestPendingAt: availability.oldestPendingAt }),
    ...(availability.oldestRunningAt === undefined
      ? {}
      : { oldestRunningAt: availability.oldestRunningAt }),
  };
}
