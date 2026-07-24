import type { ScheduleId, ScheduleRecord } from "../../types/schedule.ts";
import type { WorkflowRecoveryScheduleSummary } from "../../types/summary.ts";

interface WorkflowRecoveryScheduleNextFire {
  readonly scheduleId: ScheduleId;
  readonly timestamp: Temporal.Instant;
}

interface WorkflowRecoveryScheduleAccumulator {
  readonly dueScheduleIds: Set<string>;
  readonly invalidNextFireScheduleIds: Set<string>;
  readonly scheduleIds: Set<string>;
  nextFire?: WorkflowRecoveryScheduleNextFire;
}

export interface WorkflowRecoveryScheduleSummaryReducer {
  addSchedule(schedule: ScheduleRecord): void;
  finish(): WorkflowRecoveryScheduleSummary;
}

export function createWorkflowRecoveryScheduleSummaryReducer(
  now: Temporal.Instant,
): WorkflowRecoveryScheduleSummaryReducer {
  const schedules = createWorkflowRecoveryScheduleAccumulator();

  return {
    addSchedule(schedule) {
      addWorkflowRecoverySchedule(schedules, schedule, now);
    },
    finish() {
      return finishWorkflowRecoveryScheduleSummary(schedules);
    },
  };
}

function createWorkflowRecoveryScheduleAccumulator(): WorkflowRecoveryScheduleAccumulator {
  return {
    dueScheduleIds: new Set<string>(),
    invalidNextFireScheduleIds: new Set<string>(),
    scheduleIds: new Set<string>(),
  };
}

function addWorkflowRecoverySchedule(
  schedules: WorkflowRecoveryScheduleAccumulator,
  schedule: ScheduleRecord,
  now: Temporal.Instant,
): void {
  if (schedule.status !== "active") {
    return;
  }
  schedules.scheduleIds.add(schedule.id);
  if (Temporal.Instant.compare(schedule.nextFireAt, now) <= 0) {
    schedules.dueScheduleIds.add(schedule.id);
  }
  schedules.nextFire = earliestWorkflowRecoveryScheduleFire(
    schedules.nextFire,
    schedule.id,
    schedule.nextFireAt,
  );
}

function finishWorkflowRecoveryScheduleSummary(
  schedules: WorkflowRecoveryScheduleAccumulator,
): WorkflowRecoveryScheduleSummary {
  return {
    total: schedules.scheduleIds.size,
    due: schedules.dueScheduleIds.size,
    scheduleIds: [...schedules.scheduleIds].sort(),
    dueScheduleIds: [...schedules.dueScheduleIds].sort(),
    invalidNextFireScheduleIds: [...schedules.invalidNextFireScheduleIds].sort(),
    ...(schedules.nextFire === undefined
      ? {}
      : {
          nextFireAt: schedules.nextFire.timestamp,
          nextFireScheduleId: schedules.nextFire.scheduleId,
        }),
  };
}

function earliestWorkflowRecoveryScheduleFire(
  current: WorkflowRecoveryScheduleNextFire | undefined,
  scheduleId: ScheduleId,
  timestamp: Temporal.Instant,
): WorkflowRecoveryScheduleNextFire {
  return current === undefined || Temporal.Instant.compare(timestamp, current.timestamp) < 0
    ? { scheduleId, timestamp }
    : current;
}
