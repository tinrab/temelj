import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";

import {
  earliestWorkflowRecoveryDeadline,
  mergeWorkflowRecoveryRunIds,
  workflowRecoveryDeadline,
} from "../../src/engine/recovery.ts";
import { createWorkflowRecoveryDueRunSummaryReducer } from "../../src/engine/summary/recovery-due-runs.ts";
import { createWorkflowRecoveryFailedRunSummaryReducer } from "../../src/engine/summary/recovery-failed-runs.ts";
import { createWorkflowRecoveryLeaseRunSummaryReducer } from "../../src/engine/summary/recovery-lease-runs.ts";
import { createWorkflowRecoveryRetryRunSummaryReducer } from "../../src/engine/summary/recovery-retry-runs.ts";
import { createWorkflowRecoveryRunSummaryReducer } from "../../src/engine/summary/recovery-runs.ts";

describe("workflow recovery run summary reducer", () => {
  test("summarizes due runs, stale leases, retries, and failed runs", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");
    const reducer = createWorkflowRecoveryRunSummaryReducer(now);
    reducer.addRun(
      runRecord("run_due_pending", "pending", {
        availableAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_future_waiting", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:10:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_retry_due", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        retryAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        retryReason: "step",
        retryAttempt: 2,
      }),
    );
    reducer.addRun(
      runRecord("run_missing_impl_future", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        retryAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        retryReason: "missing_implementation",
        retryAttempt: 1,
      }),
    );
    reducer.addRun(
      runRecord("run_stale_lease", "running", {
        workerId: "worker_a",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_ownerless_lease", "running", {
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_missing_lease", "running", {
        workerId: "worker_missing_lease",
      }),
    );
    reducer.addRun(
      runRecord("run_failed", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        error: { name: "Error", message: "boom" },
      }),
    );

    expect(reducer.finish()).toMatchObject({
      total: 8,
      recoverableRunIds: [
        "run_due_pending",
        "run_failed",
        "run_missing_lease",
        "run_ownerless_lease",
        "run_retry_due",
        "run_stale_lease",
      ],
      due: {
        total: 2,
        runIds: ["run_due_pending", "run_retry_due"],
        pendingRunIds: ["run_due_pending"],
        waitingRunIds: ["run_retry_due"],
        nextAvailableAt: Temporal.Instant.from("2026-06-12T10:10:00Z"),
        nextAvailableRunId: "run_future_waiting",
      },
      lease: {
        total: 3,
        stale: 3,
        runIds: ["run_missing_lease", "run_ownerless_lease", "run_stale_lease"],
        staleRunIds: ["run_missing_lease", "run_ownerless_lease", "run_stale_lease"],
        ownerlessRunIds: ["run_ownerless_lease"],
        missingExpiresAtRunIds: ["run_missing_lease"],
        expiredRunIds: ["run_stale_lease"],
        workerIds: ["worker_a", "worker_missing_lease"],
        oldestStaleAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
      },
      retry: {
        total: 2,
        due: 1,
        runIds: ["run_missing_impl_future", "run_retry_due"],
        dueRunIds: ["run_retry_due"],
        nextRetryAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        nextRetryRunId: "run_missing_impl_future",
      },
      missingImplementation: {
        total: 1,
        due: 0,
        runIds: ["run_missing_impl_future"],
        dueRunIds: [],
        nextRetryAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        nextRetryRunId: "run_missing_impl_future",
      },
      failed: {
        total: 1,
        runIds: ["run_failed"],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      },
      nextAvailable: {
        runId: "run_future_waiting",
        timestamp: Temporal.Instant.from("2026-06-12T10:10:00Z"),
      },
      nextRetry: {
        runId: "run_missing_impl_future",
        timestamp: Temporal.Instant.from("2026-06-12T10:20:00Z"),
      },
    });
  });
});

describe("workflow recovery due run summary reducer", () => {
  test("summarizes due pending and waiting runs plus the next available run", () => {
    const reducer = createWorkflowRecoveryDueRunSummaryReducer(
      Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );

    reducer.addRun(runRecord("run_pending", "pending"));
    reducer.addRun(
      runRecord("run_waiting", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_future", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      }),
    );
    reducer.addRun(runRecord("run_running", "running"));

    expect(reducer.finish()).toEqual({
      due: {
        total: 2,
        runIds: ["run_pending", "run_waiting"],
        pendingRunIds: ["run_pending"],
        waitingRunIds: ["run_waiting"],
        invalidScheduleRunIds: [],
        nextAvailableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        nextAvailableRunId: "run_future",
      },
      dueRunIds: ["run_pending", "run_waiting"],
      nextAvailable: {
        runId: "run_future",
        timestamp: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      },
    });
  });
});

describe("workflow recovery lease run summary reducer", () => {
  test("summarizes stale running leases and next active lease expiry", () => {
    const reducer = createWorkflowRecoveryLeaseRunSummaryReducer(
      Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );

    reducer.addRun(
      runRecord("run_expired", "running", {
        workerId: "worker_a",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
      }),
    );
    reducer.addRun(runRecord("run_ownerless", "running"));
    reducer.addRun(
      runRecord("run_active", "running", {
        workerId: "worker_b",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
      }),
    );
    reducer.addRun(runRecord("run_pending", "pending"));

    expect(reducer.finish()).toEqual({
      lease: {
        total: 3,
        stale: 2,
        runIds: ["run_active", "run_expired", "run_ownerless"],
        staleRunIds: ["run_expired", "run_ownerless"],
        ownerlessRunIds: ["run_ownerless"],
        missingExpiresAtRunIds: ["run_ownerless"],
        invalidExpiresAtRunIds: [],
        expiredRunIds: ["run_expired"],
        workerIds: ["worker_a", "worker_b"],
        nextExpiresAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        nextExpiringRunId: "run_active",
        oldestStaleAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
      },
      staleRunIds: ["run_expired", "run_ownerless"],
      nextLeaseExpires: {
        runId: "run_active",
        timestamp: Temporal.Instant.from("2026-06-12T10:20:00Z"),
      },
    });
  });
});

describe("workflow recovery retry run summary reducer", () => {
  test("summarizes due retries and missing implementation retries", () => {
    const reducer = createWorkflowRecoveryRetryRunSummaryReducer(
      Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );

    reducer.addRun(
      runRecord("run_retry_due", "waiting", {
        retryAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
        retryReason: "step",
      }),
    );
    reducer.addRun(
      runRecord("run_missing_future", "waiting", {
        retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        retryReason: "missing_implementation",
      }),
    );
    reducer.addRun(runRecord("run_failed", "failed", { retryReason: "step" }));

    expect(reducer.finish()).toEqual({
      retry: {
        total: 2,
        due: 1,
        runIds: ["run_missing_future", "run_retry_due"],
        dueRunIds: ["run_retry_due"],
        nextRetryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        nextRetryRunId: "run_missing_future",
      },
      missingImplementation: {
        total: 1,
        due: 0,
        runIds: ["run_missing_future"],
        dueRunIds: [],
        nextRetryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        nextRetryRunId: "run_missing_future",
      },
      dueRetryRunIds: ["run_retry_due"],
      nextRetry: {
        runId: "run_missing_future",
        timestamp: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      },
    });
  });
});

describe("workflow recovery failed run summary reducer", () => {
  test("summarizes failed run ids and latest failure timestamp", () => {
    const reducer = createWorkflowRecoveryFailedRunSummaryReducer();

    reducer.addRun(
      runRecord("run_failed_old", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      }),
    );
    reducer.addRun(runRecord("run_pending", "pending"));
    reducer.addRun(
      runRecord("run_failed_new", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
      }),
    );

    expect(reducer.finish()).toEqual({
      failed: {
        total: 2,
        runIds: ["run_failed_new", "run_failed_old"],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
      },
      failedRunIds: ["run_failed_new", "run_failed_old"],
    });
  });
});

describe("workflow recovery summary helpers", () => {
  test("merges recoverable run IDs into a sorted unique list", () => {
    expect(
      mergeWorkflowRecoveryRunIds([["run_b", "run_a"], ["run_c", "run_a"], [], ["run_b"]]),
    ).toEqual(["run_a", "run_b", "run_c"]);
  });

  test("selects the earliest next recovery deadline", () => {
    const earliest = workflowRecoveryDeadline(
      "run_earliest",
      Temporal.Instant.from("2026-06-12T10:05:00Z"),
    );
    const later = workflowRecoveryDeadline(
      "run_later",
      Temporal.Instant.from("2026-06-12T10:30:00Z"),
    );
    const missingOwner = workflowRecoveryDeadline(
      undefined,
      Temporal.Instant.from("2026-06-12T09:00:00Z"),
    );

    expect(earliestWorkflowRecoveryDeadline([later, missingOwner, earliest])).toEqual(earliest);
  });
});

function runRecord(
  id: string,
  status: WorkflowRunRecord["status"],
  patch: Partial<WorkflowRunRecord> = {},
): WorkflowRunRecord {
  const timestamp = Temporal.Instant.from("2026-06-12T09:00:00Z");
  return {
    id,
    namespace: "default",
    workflowName: "summary",
    status,
    input: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason:
      status === "running" ? "claimed" : status === "failed" ? "failed" : "created",
    ...patch,
  };
}
