import { describe, expect, test } from "vitest";

import type { RunRecord } from "../../types/run.ts";

import { summarizeRecovery } from "./recovery.ts";

describe("workflow recovery run summary", () => {
  test("summarizes due runs, stale leases, retries, and failed runs", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");

    const summary = summarizeRecovery({
      now: now,
      runs: [
        runRecord("run_due_pending", "pending", {
          availableAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
        }),
        runRecord("run_future_waiting", "waiting", {
          availableAt: Temporal.Instant.from("2026-06-12T10:10:00Z"),
        }),
        runRecord("run_retry_due", "waiting", {
          availableAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
          retryAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          retryReason: "step",
          retryAttempt: 2,
        }),
        runRecord("run_missing_impl_future", "waiting", {
          availableAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
          retryAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
          retryReason: "missing_implementation",
          retryAttempt: 1,
        }),
        runRecord("run_stale_lease", "running", {
          workerId: "worker_a",
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
        }),
        runRecord("run_ownerless_lease", "running", {
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        }),
        runRecord("run_missing_lease", "running", {
          workerId: "worker_missing_lease",
        }),
        runRecord("run_failed", "failed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
          error: { name: "Error", message: "boom" },
        }),
      ],
    });

    expect(summary).toMatchObject({
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
        runIds: ["run_due_pending", "run_retry_due"],
        pendingRunIds: ["run_due_pending"],
        waitingRunIds: ["run_retry_due"],
        next: { at: Temporal.Instant.from("2026-06-12T10:10:00Z"), runId: "run_future_waiting" },
      },
      lease: {
        runIds: ["run_missing_lease", "run_ownerless_lease", "run_stale_lease"],
        staleRunIds: ["run_missing_lease", "run_ownerless_lease", "run_stale_lease"],
        ownerlessRunIds: ["run_ownerless_lease"],
        missingExpiresAtRunIds: ["run_missing_lease"],
        expiredRunIds: ["run_stale_lease"],
        workerIds: ["worker_a", "worker_missing_lease"],
        oldestStaleAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
      },
      retry: {
        runIds: ["run_missing_impl_future", "run_retry_due"],
        dueRunIds: ["run_retry_due"],
        next: {
          at: Temporal.Instant.from("2026-06-12T10:20:00Z"),
          runId: "run_missing_impl_future",
        },
      },
      missingImplementation: {
        runIds: ["run_missing_impl_future"],
        dueRunIds: [],
        next: {
          at: Temporal.Instant.from("2026-06-12T10:20:00Z"),
          runId: "run_missing_impl_future",
        },
      },
      failed: {
        runIds: ["run_failed"],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      },
    });
  });
});

describe("workflow recovery due run summary", () => {
  test("summarizes due pending and waiting runs plus the next available run", () => {
    const summary = summarizeRecovery({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_pending", "pending"),
        runRecord("run_waiting", "waiting", {
          availableAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
        }),
        runRecord("run_future", "waiting", {
          availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        }),
        runRecord("run_running", "running"),
      ],
    });

    expect({ due: summary.due }).toEqual({
      due: {
        runIds: ["run_pending", "run_waiting"],
        pendingRunIds: ["run_pending"],
        waitingRunIds: ["run_waiting"],
        next: { at: Temporal.Instant.from("2026-06-12T10:05:00Z"), runId: "run_future" },
      },
    });
  });
});

describe("workflow recovery lease run summary", () => {
  test("summarizes stale running leases and next active lease expiry", () => {
    const summary = summarizeRecovery({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_expired", "running", {
          workerId: "worker_a",
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
        }),
        runRecord("run_ownerless", "running"),
        runRecord("run_active", "running", {
          workerId: "worker_b",
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        }),
        runRecord("run_pending", "pending"),
      ],
    });

    expect({ lease: summary.lease }).toEqual({
      lease: {
        runIds: ["run_active", "run_expired", "run_ownerless"],
        staleRunIds: ["run_expired", "run_ownerless"],
        ownerlessRunIds: ["run_ownerless"],
        missingExpiresAtRunIds: ["run_ownerless"],
        expiredRunIds: ["run_expired"],
        workerIds: ["worker_a", "worker_b"],
        oldestStaleAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
        next: { at: Temporal.Instant.from("2026-06-12T10:20:00Z"), runId: "run_active" },
      },
    });
  });
});

describe("workflow recovery retry run summary", () => {
  test("summarizes due retries and missing implementation retries", () => {
    const summary = summarizeRecovery({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_retry_due", "waiting", {
          retryAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
          retryReason: "step",
        }),
        runRecord("run_missing_future", "waiting", {
          retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
          retryReason: "missing_implementation",
        }),
        runRecord("run_failed", "failed", { retryReason: "step" }),
      ],
    });

    expect({ retry: summary.retry, missingImplementation: summary.missingImplementation }).toEqual({
      retry: {
        runIds: ["run_missing_future", "run_retry_due"],
        dueRunIds: ["run_retry_due"],
        next: { at: Temporal.Instant.from("2026-06-12T10:05:00Z"), runId: "run_missing_future" },
      },
      missingImplementation: {
        runIds: ["run_missing_future"],
        dueRunIds: [],
        next: { at: Temporal.Instant.from("2026-06-12T10:05:00Z"), runId: "run_missing_future" },
      },
    });
  });
});

describe("workflow recovery failed run summary", () => {
  test("summarizes failed run ids and latest failure timestamp", () => {
    const summary = summarizeRecovery({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_failed_old", "failed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        }),
        runRecord("run_pending", "pending"),
        runRecord("run_failed_new", "failed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
        }),
      ],
    });

    expect({ failed: summary.failed }).toEqual({
      failed: {
        runIds: ["run_failed_new", "run_failed_old"],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
      },
    });
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
