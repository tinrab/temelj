import type { WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowRecoveryLeaseSummary } from "../../types/summary.ts";

import {
  earliestWorkflowRecoveryInstant,
  earliestWorkflowRecoveryTimestamp,
  type WorkflowRecoveryTimestamp,
} from "./recovery-run-timestamps.ts";

export interface WorkflowRecoveryLeaseRunSummaryParts {
  readonly lease: WorkflowRecoveryLeaseSummary;
  readonly staleRunIds: readonly string[];
  readonly nextLeaseExpires?: WorkflowRecoveryTimestamp;
}

export interface WorkflowRecoveryLeaseRunSummaryReducer {
  addRun(run: WorkflowRunRecord): void;
  finish(): WorkflowRecoveryLeaseRunSummaryParts;
}

interface WorkflowRecoveryLeaseRunAccumulator {
  readonly runIds: Set<string>;
  readonly staleRunIds: Set<string>;
  readonly ownerlessRunIds: Set<string>;
  readonly missingExpiresAtRunIds: Set<string>;
  readonly invalidExpiresAtRunIds: Set<string>;
  readonly expiredRunIds: Set<string>;
  readonly workerIds: Set<string>;
  nextExpires?: WorkflowRecoveryTimestamp;
  oldestStaleAt?: Temporal.Instant;
}

export function createWorkflowRecoveryLeaseRunSummaryReducer(
  now: Temporal.Instant,
): WorkflowRecoveryLeaseRunSummaryReducer {
  const lease = createWorkflowRecoveryLeaseRunAccumulator();
  return {
    addRun(run) {
      addWorkflowRecoveryLeaseRun(lease, run, now);
    },
    finish() {
      return {
        lease: finishWorkflowRecoveryLeaseSummary(lease),
        staleRunIds: [...lease.staleRunIds].sort(),
        ...(lease.nextExpires === undefined ? {} : { nextLeaseExpires: lease.nextExpires }),
      };
    },
  };
}

function createWorkflowRecoveryLeaseRunAccumulator(): WorkflowRecoveryLeaseRunAccumulator {
  return {
    runIds: new Set<string>(),
    staleRunIds: new Set<string>(),
    ownerlessRunIds: new Set<string>(),
    missingExpiresAtRunIds: new Set<string>(),
    invalidExpiresAtRunIds: new Set<string>(),
    expiredRunIds: new Set<string>(),
    workerIds: new Set<string>(),
  };
}

function addWorkflowRecoveryLeaseRun(
  lease: WorkflowRecoveryLeaseRunAccumulator,
  run: WorkflowRunRecord,
  now: Temporal.Instant,
): void {
  if (run.status !== "running") {
    return;
  }
  lease.runIds.add(run.id);
  if (run.workerId !== undefined) {
    lease.workerIds.add(run.workerId);
  } else {
    lease.staleRunIds.add(run.id);
    lease.ownerlessRunIds.add(run.id);
  }
  if (run.leaseExpiresAt === undefined) {
    lease.staleRunIds.add(run.id);
    lease.missingExpiresAtRunIds.add(run.id);
    return;
  }
  if (Temporal.Instant.compare(run.leaseExpiresAt, now) <= 0) {
    lease.staleRunIds.add(run.id);
    lease.expiredRunIds.add(run.id);
    lease.oldestStaleAt = earliestWorkflowRecoveryInstant(lease.oldestStaleAt, run.leaseExpiresAt);
    return;
  }
  if (run.workerId !== undefined) {
    lease.nextExpires = earliestWorkflowRecoveryTimestamp(
      lease.nextExpires,
      run.id,
      run.leaseExpiresAt,
    );
  }
}

function finishWorkflowRecoveryLeaseSummary(
  lease: WorkflowRecoveryLeaseRunAccumulator,
): WorkflowRecoveryLeaseSummary {
  return {
    total: lease.runIds.size,
    stale: lease.staleRunIds.size,
    runIds: [...lease.runIds].sort(),
    staleRunIds: [...lease.staleRunIds].sort(),
    ownerlessRunIds: [...lease.ownerlessRunIds].sort(),
    missingExpiresAtRunIds: [...lease.missingExpiresAtRunIds].sort(),
    invalidExpiresAtRunIds: [...lease.invalidExpiresAtRunIds].sort(),
    expiredRunIds: [...lease.expiredRunIds].sort(),
    workerIds: [...lease.workerIds].sort(),
    ...(lease.nextExpires === undefined
      ? {}
      : { nextExpiresAt: lease.nextExpires.timestamp, nextExpiringRunId: lease.nextExpires.runId }),
    ...(lease.oldestStaleAt === undefined ? {} : { oldestStaleAt: lease.oldestStaleAt }),
  };
}
