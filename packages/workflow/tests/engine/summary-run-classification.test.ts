import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { createWorkflowRunCleanupSummaryReducer } from "../../src/engine/summary/run-cleanup.ts";
import { createWorkflowRunStatusSummaryReducer } from "../../src/engine/summary/run-status.ts";
import { createWorkflowRunWorkflowSummaryReducer } from "../../src/engine/summary/run-workflow.ts";

describe("workflow run cleanup summary reducer", () => {
  test("summarizes terminal runs older than the cleanup cutoff", () => {
    const reducer = createWorkflowRunCleanupSummaryReducer(
      Temporal.Instant.from("2026-06-12T09:30:00Z"),
    );

    reducer.addRun(
      runRecord("run_completed_old", "completed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_failed_old", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      }),
    );
    reducer.addRun(
      runRecord("run_canceled_new", "canceled", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
      }),
    );
    reducer.addRun(runRecord("run_waiting", "waiting"));

    expect(reducer.finish()).toEqual({
      cleanup: {
        eligibleRuns: 2,
        status: { completed: 1, failed: 1, canceled: 0 },
        statusRunIds: {
          completed: ["run_completed_old"],
          failed: ["run_failed_old"],
          canceled: [],
        },
        oldestFinishedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        newestFinishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      },
    });
  });

  test("omits cleanup when no cutoff is configured", () => {
    const reducer = createWorkflowRunCleanupSummaryReducer(undefined);

    reducer.addRun(
      runRecord("run_completed", "completed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      }),
    );

    expect(reducer.finish()).toEqual({});
  });
});

describe("workflow run status summary reducer", () => {
  test("summarizes run counts and sorted run ids by status", () => {
    const reducer = createWorkflowRunStatusSummaryReducer();

    reducer.addRun(runRecord("run_waiting", "waiting"));
    reducer.addRun(runRecord("run_running_b", "running"));
    reducer.addRun(runRecord("run_failed", "failed"));
    reducer.addRun(runRecord("run_running_a", "running"));
    reducer.addRun(runRecord("run_completed", "completed"));
    reducer.addRun(runRecord("run_canceled", "canceled"));
    reducer.addRun(runRecord("run_pending", "pending"));

    expect(reducer.finish()).toEqual({
      total: 7,
      status: {
        pending: 1,
        running: 2,
        waiting: 1,
        completed: 1,
        failed: 1,
        canceled: 1,
      },
      statusRunIds: {
        pending: ["run_pending"],
        running: ["run_running_a", "run_running_b"],
        waiting: ["run_waiting"],
        completed: ["run_completed"],
        failed: ["run_failed"],
        canceled: ["run_canceled"],
      },
    });
  });

  test("returns empty status buckets when no runs are present", () => {
    const reducer = createWorkflowRunStatusSummaryReducer();

    expect(reducer.finish()).toEqual({
      total: 0,
      status: {
        pending: 0,
        running: 0,
        waiting: 0,
        completed: 0,
        failed: 0,
        canceled: 0,
      },
      statusRunIds: {
        pending: [],
        running: [],
        waiting: [],
        completed: [],
        failed: [],
        canceled: [],
      },
    });
  });
});

describe("workflow run workflow summary reducer", () => {
  test("groups runs by workflow name and version with sorted entries and run ids", () => {
    const reducer = createWorkflowRunWorkflowSummaryReducer();

    reducer.addRun(
      runRecord("run_beta_b", "running", {
        workflowName: "beta",
      }),
    );
    reducer.addRun(
      runRecord("run_alpha_v2", "pending", {
        workflowName: "alpha",
        workflowVersion: "v2",
      }),
    );
    reducer.addRun(
      runRecord("run_alpha_a", "completed", {
        workflowName: "alpha",
      }),
    );
    reducer.addRun(
      runRecord("run_beta_a", "waiting", {
        workflowName: "beta",
      }),
    );

    expect(reducer.finish()).toEqual({
      total: 3,
      workflows: [
        { name: "alpha", count: 1, runIds: ["run_alpha_a"] },
        { name: "alpha", version: "v2", count: 1, runIds: ["run_alpha_v2"] },
        { name: "beta", count: 2, runIds: ["run_beta_a", "run_beta_b"] },
      ],
    });
  });

  test("returns an empty workflow summary when no runs are present", () => {
    const reducer = createWorkflowRunWorkflowSummaryReducer();

    expect(reducer.finish()).toEqual({ total: 0, workflows: [] });
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
