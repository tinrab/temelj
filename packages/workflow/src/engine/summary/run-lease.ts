import type { RunId, WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowRunLeaseSummary } from "../../types/summary.ts";

import { earliestOptionalTimestamp } from "../../temporal.ts";

interface WorkflowRunLeaseAccumulator {
  total: number;
  expired: number;
  nextExpiresAt?: Temporal.Instant;
  nextExpiringRunId?: RunId;
  oldestExpiredAt?: Temporal.Instant;
  readonly runIds: Set<string>;
  readonly expiredRunIds: Set<string>;
  readonly workerIds: Set<string>;
}

export interface WorkflowRunLeaseSummaryReducer {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunLeaseSummary;
}

/** Creates an accumulator for running-run lease summary fields. */
export function createWorkflowRunLeaseSummaryReducer(
  now: Temporal.Instant,
): WorkflowRunLeaseSummaryReducer {
  const lease = createWorkflowRunLeaseAccumulator();

  return {
    addRun(run) {
      if (run.status === "running") {
        addWorkflowRunLease(lease, run, now);
      }
    },
    finish() {
      return finishWorkflowRunLeaseSummary(lease);
    },
  };
}

function createWorkflowRunLeaseAccumulator(): WorkflowRunLeaseAccumulator {
  return {
    total: 0,
    expired: 0,
    runIds: new Set<string>(),
    expiredRunIds: new Set<string>(),
    workerIds: new Set<string>(),
  };
}

function addWorkflowRunLease(
  lease: WorkflowRunLeaseAccumulator,
  run: WorkflowRunRecord,
  now: Temporal.Instant,
): void {
  lease.total++;
  lease.runIds.add(run.id);
  if (run.workerId !== undefined) {
    lease.workerIds.add(run.workerId);
  }
  if (run.workerId === undefined || run.leaseExpiresAt === undefined) {
    lease.expired++;
    lease.expiredRunIds.add(run.id);
    return;
  }
  if (Temporal.Instant.compare(run.leaseExpiresAt, now) <= 0) {
    lease.expired++;
    lease.expiredRunIds.add(run.id);
    setWorkflowRunLeaseOldestExpiration(lease, run);
    return;
  }
  setWorkflowRunLeaseNextExpiration(lease, run.id, run.leaseExpiresAt);
}

function setWorkflowRunLeaseOldestExpiration(
  lease: WorkflowRunLeaseAccumulator,
  run: WorkflowRunRecord,
): void {
  lease.oldestExpiredAt = earliestOptionalTimestamp(lease.oldestExpiredAt, run.leaseExpiresAt);
}

function setWorkflowRunLeaseNextExpiration(
  lease: WorkflowRunLeaseAccumulator,
  runId: RunId,
  leaseExpiresAt: Temporal.Instant,
): void {
  if (
    lease.nextExpiresAt !== undefined &&
    Temporal.Instant.compare(leaseExpiresAt, lease.nextExpiresAt) >= 0
  ) {
    return;
  }
  lease.nextExpiresAt = leaseExpiresAt;
  lease.nextExpiringRunId = runId;
}

function finishWorkflowRunLeaseSummary(
  lease: WorkflowRunLeaseAccumulator,
): WorkflowRunLeaseSummary {
  return {
    total: lease.total,
    expired: lease.expired,
    runIds: [...lease.runIds].sort(),
    expiredRunIds: [...lease.expiredRunIds].sort(),
    workerIds: [...lease.workerIds].sort(),
    ...(lease.nextExpiresAt === undefined
      ? {}
      : {
          nextExpiresAt: lease.nextExpiresAt,
          ...(lease.nextExpiringRunId === undefined
            ? {}
            : { nextExpiringRunId: lease.nextExpiringRunId }),
        }),
    ...(lease.oldestExpiredAt === undefined ? {} : { oldestExpiredAt: lease.oldestExpiredAt }),
  };
}
