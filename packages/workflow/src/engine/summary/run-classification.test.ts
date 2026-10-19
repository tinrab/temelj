import { describe, expect, test } from "vitest";

import type { RunRecord } from "../../types/run.ts";

import { summarizeRuns } from "./runs.ts";

describe("workflow run cleanup summary", () => {
  test("summarizes terminal runs older than the cleanup cutoff", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      cleanupCutoff: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      runs: [
        runRecord("run_completed_old", "completed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        }),
        runRecord("run_failed_old", "failed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        }),
        runRecord("run_canceled_new", "canceled", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
        }),
        runRecord("run_waiting", "waiting"),
      ],
    });

    expect({ cleanup: summary.cleanup }).toEqual({
      cleanup: {
        status: { completed: 1, failed: 1, canceled: 0 },
        oldestFinishedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        newestFinishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      },
    });
  });

  test("omits cleanup when no cutoff is configured", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_completed", "completed", {
          finishedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        }),
      ],
    });

    expect({ cleanup: summary.cleanup }).toEqual({});
  });
});

describe("workflow run status summary", () => {
  test("summarizes run counts and sorted run ids by status", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_waiting", "waiting"),
        runRecord("run_running_b", "running"),
        runRecord("run_failed", "failed"),
        runRecord("run_running_a", "running"),
        runRecord("run_completed", "completed"),
        runRecord("run_canceled", "canceled"),
        runRecord("run_pending", "pending"),
      ],
    });

    expect({
      total: summary.total,
      status: summary.status,
    }).toEqual({
      total: 7,
      status: { pending: 1, running: 2, waiting: 1, completed: 1, failed: 1, canceled: 1 },
    });
  });

  test("returns empty status buckets when no runs are present", () => {
    const summary = summarizeRuns({ now: Temporal.Instant.from("2026-06-12T10:00:00Z"), runs: [] });

    expect({
      total: summary.total,
      status: summary.status,
    }).toEqual({
      total: 0,
      status: { pending: 0, running: 0, waiting: 0, completed: 0, failed: 0, canceled: 0 },
    });
  });
});

describe("workflow run workflow summary", () => {
  test("counts runs by workflow name and version in sorted order", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [
        runRecord("run_beta_b", "running", {
          workflowName: "beta",
        }),
        runRecord("run_alpha_v2", "pending", {
          workflowName: "alpha",
          workflowVersion: "v2",
        }),
        runRecord("run_alpha_a", "completed", {
          workflowName: "alpha",
        }),
        runRecord("run_beta_a", "waiting", {
          workflowName: "beta",
        }),
      ],
    });

    expect(summary.workflows).toEqual([
      { name: "alpha", count: 1 },
      { name: "alpha", version: "v2", count: 1 },
      { name: "beta", count: 2 },
    ]);
  });

  test("returns an empty workflow summary when no runs are present", () => {
    const summary = summarizeRuns({ now: Temporal.Instant.from("2026-06-12T10:00:00Z"), runs: [] });

    expect(summary.workflows).toEqual([]);
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
