import { describe, expect, test } from "vitest";

import type { RunRecord } from "../../types/run.ts";

import { summarizeRuns } from "./runs.ts";

describe("workflow run state summary", () => {
  test("summarizes run state, retries, failures, leases, workflows, and cleanup", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");

    const summary = summarizeRuns({
      now: now,
      cleanupCutoff: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      runs: [
        runRecord("run_pending", "pending", {
          workflowName: "alpha",
          availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        }),
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
        runRecord("run_stale", "running", {
          workflowName: "beta",
          workerId: "worker-a",
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
          startedAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
        }),
        runRecord("run_active", "running", {
          workflowName: "beta",
          workerId: "worker-b",
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          startedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
        }),
        runRecord("run_failed", "failed", {
          workflowName: "gamma",
          finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          error: { name: "Failure", message: "boom" },
        }),
      ],
    });

    expect(summary).toMatchObject({
      total: 5,
      status: { pending: 1, running: 2, waiting: 1, completed: 0, failed: 1, canceled: 0 },
      workflows: [
        { name: "alpha", count: 1 },
        { name: "alpha", version: "v2", count: 1 },
        { name: "beta", count: 2 },
        { name: "gamma", count: 1 },
      ],
      retry: {
        count: 1,
        stepNames: ["retry-step"],
        highestAttempt: 3,
        reason: { workflow: 0, step: 1, missing_implementation: 0 },
        next: { at: Temporal.Instant.from("2026-06-12T10:01:00Z"), runId: "run_retry" },
      },
      failure: {
        count: 1,
        errors: [
          {
            name: "Failure",
            count: 1,
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      },
      lease: {
        count: 2,
        expired: 1,
        workerIds: ["worker-a", "worker-b"],
        oldestExpiredAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        next: { at: Temporal.Instant.from("2026-06-12T10:30:00Z"), runId: "run_active" },
      },
      cleanup: {
        status: { completed: 0, failed: 1, canceled: 0 },
        oldestFinishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        newestFinishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      },
      nextAvailableAt: Temporal.Instant.from("2026-06-12T10:01:00Z"),
      oldestPendingAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      oldestRunningAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
    });
  });
});

describe("workflow run lease summary", () => {
  test("summarizes active, expired, ownerless, and missing running leases", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_expired", "running", {
          workerId: "worker-a",
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        }),
        runRecord("run_active", "running", {
          workerId: "worker-b",
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        }),
        runRecord("run_ownerless", "running"),
        runRecord("run_missing_expiry", "running", {
          workerId: "worker-c",
        }),
        runRecord("run_waiting", "waiting"),
      ],
    });

    expect(summary.lease).toEqual({
      count: 4,
      expired: 3,
      workerIds: ["worker-a", "worker-b", "worker-c"],
      oldestExpiredAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      next: { at: Temporal.Instant.from("2026-06-12T10:30:00Z"), runId: "run_active" },
    });
  });
});

describe("workflow run failure summary", () => {
  test("summarizes failed runs by error name and latest failure time", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_alpha_first", "failed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
          error: { name: "AlphaError", message: "first alpha" },
        }),
        runRecord("run_beta", "failed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
          error: { name: "BetaError", message: "beta" },
        }),
        runRecord("run_alpha_latest", "failed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          error: { name: "AlphaError", message: "latest alpha" },
        }),
        runRecord("run_unknown", "failed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        }),
        runRecord("run_completed", "completed"),
      ],
    });

    expect({ failure: summary.failure }).toEqual({
      failure: {
        count: 4,
        errors: [
          {
            name: "AlphaError",
            count: 2,
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          },
          {
            name: "BetaError",
            count: 1,
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
          },
          {
            name: "Error",
            count: 1,
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      },
    });
  });

  test("omits failure summary when no failed runs are present", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [runRecord("run_completed", "completed")],
    });

    expect({ failure: summary.failure }).toEqual({});
  });
});

describe("workflow run retry summary", () => {
  test("summarizes retry runs by reason, step metadata, next retry, and highest attempt", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_step_later", "waiting", {
          retryAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          retryReason: "step",
          retryAttempt: 2,
          retryStepId: "step:beta",
          retryStepName: "beta",
        }),
        runRecord("run_workflow_earlier", "pending", {
          retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
          retryReason: "workflow",
          retryAttempt: 5,
        }),
        runRecord("run_missing_impl", "waiting", {
          retryReason: "missing_implementation",
          retryStepId: "step:alpha",
          retryStepName: "alpha",
        }),
        runRecord("run_completed_ignored", "completed", {
          retryAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          retryReason: "step",
          retryAttempt: 9,
        }),
      ],
    });

    expect(summary.retry).toEqual({
      count: 3,
      stepNames: ["alpha", "beta"],
      reason: { workflow: 1, step: 1, missing_implementation: 1 },
      highestAttempt: 5,
      next: { at: Temporal.Instant.from("2026-06-12T10:05:00Z"), runId: "run_workflow_earlier" },
    });
  });

  test("returns an empty retry summary when no retry runs are present", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_pending", "pending"),
        runRecord("run_failed", "failed", { retryReason: "step" }),
      ],
    });

    expect(summary.retry).toEqual({
      count: 0,
      stepNames: [],
      reason: { workflow: 0, step: 0, missing_implementation: 0 },
    });
  });
});

describe("workflow run transition summary", () => {
  test("summarizes transition reasons, run ids, and latest transition time", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_created_b", "pending", {
          lastTransitionAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
          lastTransitionReason: "created",
        }),
        runRecord("run_retry", "waiting", {
          lastTransitionAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
          lastTransitionReason: "retry",
        }),
        runRecord("run_created_a", "pending", {
          lastTransitionAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          lastTransitionReason: "created",
        }),
      ],
    });

    expect(summary.transition).toEqual({
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
      latestTransitionAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
    });
  });

  test("returns an empty transition summary when no runs are present", () => {
    const summary = summarizeRuns({ now: Temporal.Instant.from("2026-06-12T10:00:00Z"), runs: [] });

    expect(summary.transition).toEqual({
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
    });
  });
});

describe("workflow run availability summary", () => {
  test("summarizes next available, oldest pending, and oldest running timestamps", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_pending_later", "pending", {
          createdAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
          availableAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        }),
        runRecord("run_waiting_earlier", "waiting", {
          createdAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
          availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        }),
        runRecord("run_running_started", "running", {
          createdAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
          startedAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
        }),
        runRecord("run_running_unstarted", "running", {
          createdAt: Temporal.Instant.from("2026-06-12T08:55:00Z"),
        }),
        runRecord("run_completed_ignored", "completed", {
          createdAt: Temporal.Instant.from("2026-06-12T08:00:00Z"),
          availableAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        }),
      ],
    });

    expect({
      nextAvailableAt: summary.nextAvailableAt,
      oldestPendingAt: summary.oldestPendingAt,
      oldestRunningAt: summary.oldestRunningAt,
    }).toEqual({
      nextAvailableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      oldestPendingAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      oldestRunningAt: Temporal.Instant.from("2026-06-12T08:55:00Z"),
    });
  });

  test("omits availability timestamps when no scheduled or running runs are present", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [runRecord("run_completed", "completed"), runRecord("run_failed", "failed")],
    });

    expect({
      nextAvailableAt: summary.nextAvailableAt,
      oldestPendingAt: summary.oldestPendingAt,
      oldestRunningAt: summary.oldestRunningAt,
    }).toEqual({});
  });
});

describe("workflow run summary size", () => {
  test("reports counts, not run IDs, so its size does not grow with the number of runs", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");

    const summarize = (count: number) =>
      summarizeRuns({
        now,
        runs: Array.from({ length: count }, (_, index) =>
          runRecord(`run_${index}`, index % 2 === 0 ? "completed" : "failed"),
        ),
      });

    const small = summarize(10);
    const large = summarize(1000);
    const serialized = JSON.stringify(large);

    expect(large.status).toMatchObject({ completed: 500, failed: 500 });
    expect(serialized).not.toMatch(/run_\d+/u);
    expect(serialized.length - JSON.stringify(small).length).toBeLessThan(20);
  });
});

function runRecord(
  id: string,
  status: RunRecord["status"],
  patch: Partial<RunRecord> = {},
): RunRecord {
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
