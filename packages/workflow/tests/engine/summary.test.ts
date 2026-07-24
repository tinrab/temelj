import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { createWorkflowRunAvailabilitySummaryReducer } from "../../src/engine/summary/run-availability.ts";
import { createWorkflowRunFailureSummaryReducer } from "../../src/engine/summary/run-failure.ts";
import { createWorkflowRunLeaseSummaryReducer } from "../../src/engine/summary/run-lease.ts";
import { createWorkflowRunRetrySummaryReducer } from "../../src/engine/summary/run-retry.ts";
import { createWorkflowRunStateSummaryReducer } from "../../src/engine/summary/run-state.ts";
import { createWorkflowRunTransitionSummaryReducer } from "../../src/engine/summary/run-transition.ts";

describe("workflow run state summary reducer", () => {
  test("summarizes run state, retries, failures, leases, workflows, and cleanup", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");
    const reducer = createWorkflowRunStateSummaryReducer(
      now,
      Temporal.Instant.from("2026-06-12T09:59:00Z"),
    );

    reducer.addRun(
      runRecord("run_pending", "pending", {
        workflowName: "alpha",
        availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_retry", "waiting", {
        workflowName: "alpha",
        workflowVersion: "v2",
        availableAt: Temporal.Instant.from("2026-06-12T10:01:00Z"),
        retryAt: Temporal.Instant.from("2026-06-12T10:01:00Z"),
        retryReason: "step",
        retryAttempt: 3,
        retryStepId: "step:retry",
        retryStepName: "retry-step",
      }),
    );
    reducer.addRun(
      runRecord("run_stale", "running", {
        workflowName: "beta",
        workerId: "worker-a",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        startedAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_active", "running", {
        workflowName: "beta",
        workerId: "worker-b",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        startedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_failed", "failed", {
        workflowName: "gamma",
        finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        error: { name: "Failure", message: "boom" },
      }),
    );

    expect(reducer.finish()).toMatchObject({
      total: 5,
      status: {
        pending: 1,
        running: 2,
        waiting: 1,
        completed: 0,
        failed: 1,
        canceled: 0,
      },
      statusRunIds: {
        pending: ["run_pending"],
        running: ["run_active", "run_stale"],
        waiting: ["run_retry"],
        completed: [],
        failed: ["run_failed"],
        canceled: [],
      },
      workflow: {
        total: 4,
        workflows: [
          { name: "alpha", count: 1, runIds: ["run_pending"] },
          { name: "alpha", version: "v2", count: 1, runIds: ["run_retry"] },
          { name: "beta", count: 2, runIds: ["run_active", "run_stale"] },
          { name: "gamma", count: 1, runIds: ["run_failed"] },
        ],
      },
      retry: {
        total: 1,
        retryRunIds: ["run_retry"],
        retryStepIds: ["step:retry"],
        retryStepNames: ["retry-step"],
        nextRetryAt: Temporal.Instant.from("2026-06-12T10:01:00Z"),
        nextRetryRunId: "run_retry",
        highestAttempt: 3,
        reason: { workflow: 0, step: 1, missing_implementation: 0 },
      },
      failure: {
        total: 1,
        failedRunIds: ["run_failed"],
        errors: [
          {
            name: "Failure",
            count: 1,
            failedRunIds: ["run_failed"],
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      },
      lease: {
        total: 2,
        expired: 1,
        runIds: ["run_active", "run_stale"],
        expiredRunIds: ["run_stale"],
        workerIds: ["worker-a", "worker-b"],
        nextExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        nextExpiringRunId: "run_active",
        oldestExpiredAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      },
      cleanup: {
        eligibleRuns: 1,
        status: { completed: 0, failed: 1, canceled: 0 },
        statusRunIds: { completed: [], failed: ["run_failed"], canceled: [] },
        oldestFinishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        newestFinishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      },
      nextAvailableAt: Temporal.Instant.from("2026-06-12T10:01:00Z"),
      oldestPendingAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      oldestRunningAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
    });
  });
});

describe("workflow run lease summary reducer", () => {
  test("summarizes active, expired, ownerless, and missing running leases", () => {
    const reducer = createWorkflowRunLeaseSummaryReducer(
      Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );

    reducer.addRun(
      runRecord("run_expired", "running", {
        workerId: "worker-a",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_active", "running", {
        workerId: "worker-b",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    reducer.addRun(runRecord("run_ownerless", "running"));
    reducer.addRun(
      runRecord("run_missing_expiry", "running", {
        workerId: "worker-c",
      }),
    );
    reducer.addRun(runRecord("run_waiting", "waiting"));

    expect(reducer.finish()).toEqual({
      total: 4,
      expired: 3,
      runIds: ["run_active", "run_expired", "run_missing_expiry", "run_ownerless"],
      expiredRunIds: ["run_expired", "run_missing_expiry", "run_ownerless"],
      workerIds: ["worker-a", "worker-b", "worker-c"],
      nextExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      nextExpiringRunId: "run_active",
      oldestExpiredAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
    });
  });
});

describe("workflow run failure summary reducer", () => {
  test("summarizes failed runs by error name and latest failure time", () => {
    const reducer = createWorkflowRunFailureSummaryReducer();

    reducer.addRun(
      runRecord("run_alpha_first", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        error: { name: "AlphaError", message: "first alpha" },
      }),
    );
    reducer.addRun(
      runRecord("run_beta", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
        error: { name: "BetaError", message: "beta" },
      }),
    );
    reducer.addRun(
      runRecord("run_alpha_latest", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        error: { name: "AlphaError", message: "latest alpha" },
      }),
    );
    reducer.addRun(
      runRecord("run_unknown", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      }),
    );
    reducer.addRun(runRecord("run_completed", "completed"));

    expect(reducer.finish()).toEqual({
      failure: {
        total: 4,
        failedRunIds: ["run_alpha_first", "run_alpha_latest", "run_beta", "run_unknown"],
        errors: [
          {
            name: "AlphaError",
            count: 2,
            failedRunIds: ["run_alpha_first", "run_alpha_latest"],
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          },
          {
            name: "BetaError",
            count: 1,
            failedRunIds: ["run_beta"],
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
          },
          {
            name: "Error",
            count: 1,
            failedRunIds: ["run_unknown"],
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      },
    });
  });

  test("omits failure summary when no failed runs are present", () => {
    const reducer = createWorkflowRunFailureSummaryReducer();

    reducer.addRun(runRecord("run_completed", "completed"));

    expect(reducer.finish()).toEqual({});
  });
});

describe("workflow run retry summary reducer", () => {
  test("summarizes retry runs by reason, step metadata, next retry, and highest attempt", () => {
    const reducer = createWorkflowRunRetrySummaryReducer();

    reducer.addRun(
      runRecord("run_step_later", "waiting", {
        retryAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        retryReason: "step",
        retryAttempt: 2,
        retryStepId: "step:beta",
        retryStepName: "beta",
      }),
    );
    reducer.addRun(
      runRecord("run_workflow_earlier", "pending", {
        retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        retryReason: "workflow",
        retryAttempt: 5,
      }),
    );
    reducer.addRun(
      runRecord("run_missing_impl", "waiting", {
        retryReason: "missing_implementation",
        retryStepId: "step:alpha",
        retryStepName: "alpha",
      }),
    );
    reducer.addRun(
      runRecord("run_completed_ignored", "completed", {
        retryAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        retryReason: "step",
        retryAttempt: 9,
      }),
    );

    expect(reducer.finish()).toEqual({
      total: 3,
      retryRunIds: ["run_missing_impl", "run_step_later", "run_workflow_earlier"],
      retryStepIds: ["step:alpha", "step:beta"],
      retryStepNames: ["alpha", "beta"],
      reason: { workflow: 1, step: 1, missing_implementation: 1 },
      nextRetryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      nextRetryRunId: "run_workflow_earlier",
      highestAttempt: 5,
    });
  });

  test("returns an empty retry summary when no retry runs are present", () => {
    const reducer = createWorkflowRunRetrySummaryReducer();

    reducer.addRun(runRecord("run_pending", "pending"));
    reducer.addRun(runRecord("run_failed", "failed", { retryReason: "step" }));

    expect(reducer.finish()).toEqual({
      total: 0,
      retryRunIds: [],
      retryStepIds: [],
      retryStepNames: [],
      reason: { workflow: 0, step: 0, missing_implementation: 0 },
    });
  });
});

describe("workflow run transition summary reducer", () => {
  test("summarizes transition reasons, run ids, and latest transition time", () => {
    const reducer = createWorkflowRunTransitionSummaryReducer();

    reducer.addRun(
      runRecord("run_created_b", "pending", {
        lastTransitionAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        lastTransitionReason: "created",
      }),
    );
    reducer.addRun(
      runRecord("run_retry", "waiting", {
        lastTransitionAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
        lastTransitionReason: "retry",
      }),
    );
    reducer.addRun(
      runRecord("run_created_a", "pending", {
        lastTransitionAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        lastTransitionReason: "created",
      }),
    );

    expect(reducer.finish()).toEqual({
      reason: {
        created: 2,
        claimed: 0,
        reclaimed: 0,
        started: 0,
        waiting: 0,
        rescheduled: 0,
        lease_released: 0,
        manual_retry: 0,
        permanent_failure: 0,
        retry: 1,
        missing_implementation: 0,
        completed: 0,
        failed: 0,
        deadline: 0,
        canceled: 0,
      },
      runIds: {
        created: ["run_created_a", "run_created_b"],
        claimed: [],
        reclaimed: [],
        started: [],
        waiting: [],
        rescheduled: [],
        lease_released: [],
        manual_retry: [],
        permanent_failure: [],
        retry: ["run_retry"],
        missing_implementation: [],
        completed: [],
        failed: [],
        deadline: [],
        canceled: [],
      },
      latestTransitionAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
    });
  });

  test("returns an empty transition summary when no runs are present", () => {
    const reducer = createWorkflowRunTransitionSummaryReducer();

    expect(reducer.finish()).toEqual({
      reason: {
        created: 0,
        claimed: 0,
        reclaimed: 0,
        started: 0,
        waiting: 0,
        rescheduled: 0,
        lease_released: 0,
        manual_retry: 0,
        permanent_failure: 0,
        retry: 0,
        missing_implementation: 0,
        completed: 0,
        failed: 0,
        deadline: 0,
        canceled: 0,
      },
      runIds: {
        created: [],
        claimed: [],
        reclaimed: [],
        started: [],
        waiting: [],
        rescheduled: [],
        lease_released: [],
        manual_retry: [],
        permanent_failure: [],
        retry: [],
        missing_implementation: [],
        completed: [],
        failed: [],
        deadline: [],
        canceled: [],
      },
    });
  });
});

describe("workflow run availability summary reducer", () => {
  test("summarizes next available, oldest pending, and oldest running timestamps", () => {
    const reducer = createWorkflowRunAvailabilitySummaryReducer();

    reducer.addRun(
      runRecord("run_pending_later", "pending", {
        createdAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
        availableAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_waiting_earlier", "waiting", {
        createdAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_running_started", "running", {
        createdAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        startedAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_running_unstarted", "running", {
        createdAt: Temporal.Instant.from("2026-06-12T08:55:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_completed_ignored", "completed", {
        createdAt: Temporal.Instant.from("2026-06-12T08:00:00Z"),
        availableAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      }),
    );

    expect(reducer.finish()).toEqual({
      nextAvailableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      oldestPendingAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      oldestRunningAt: Temporal.Instant.from("2026-06-12T08:55:00Z"),
    });
  });

  test("omits availability timestamps when no scheduled or running runs are present", () => {
    const reducer = createWorkflowRunAvailabilitySummaryReducer();

    reducer.addRun(runRecord("run_completed", "completed"));
    reducer.addRun(runRecord("run_failed", "failed"));

    expect(reducer.finish()).toEqual({});
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
