import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../src/types/step-attempts.ts";

import { createWorkflowChildWorkflowRunSummaryReducer } from "../../src/engine/summary/child-workflow-runs.ts";
import { createWorkflowRunChildWorkflowWaitSummaryReducer } from "../../src/engine/summary/child-workflow-waits.ts";

describe("workflow run child workflow wait summary reducer", () => {
  test("summarizes child workflow run state independently from wait aggregation", () => {
    const reducer = createWorkflowChildWorkflowRunSummaryReducer();
    reducer.addRun(
      runRecord("run_child_retry", "waiting", {
        workflowName: "child",
        retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        retryReason: "workflow",
        retryAttempt: 4,
        retryStepId: "workflow:second",
        retryStepName: "second-child",
      }),
    );
    reducer.addRun(
      runRecord("run_child_failed", "failed", {
        workflowName: "child",
        finishedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
        error: { name: "ChildFailure", message: "child failed" },
      }),
    );
    reducer.addRun(
      runRecord("run_child_canceled", "canceled", {
        workflowName: "child",
        finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      }),
    );

    expect(reducer.finish()).toMatchObject({
      childStatus: {
        pending: 0,
        running: 0,
        waiting: 1,
        completed: 0,
        failed: 1,
        canceled: 1,
      },
      retryChildRunIds: ["run_child_retry"],
      failedChildRunIds: ["run_child_failed"],
      canceledChildRunIds: ["run_child_canceled"],
      childRetry: {
        total: 1,
        retryRunIds: ["run_child_retry"],
        retryStepIds: ["workflow:second"],
        retryStepNames: ["second-child"],
        nextRetryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        nextRetryRunId: "run_child_retry",
        highestAttempt: 4,
        reason: { workflow: 1, step: 0, missing_implementation: 0 },
      },
      childFailure: {
        total: 1,
        failedRunIds: ["run_child_failed"],
        errors: [
          {
            name: "ChildFailure",
            count: 1,
            failedRunIds: ["run_child_failed"],
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
      },
    });
  });

  test("summarizes active child workflow waits and child run state", () => {
    const reducer = createWorkflowRunChildWorkflowWaitSummaryReducer();
    reducer.addChildWorkflowAttempts(
      "run_parent_a",
      [
        stepAttempt("run_parent_a", "workflow:first", "first-child", "workflow", {
          attempt: 2,
          childRunId: "run_child_failed",
          workflowName: "child",
          workflowVersion: "v1",
          timeoutAt: Temporal.Instant.from("2026-06-12T10:40:00Z"),
        }),
      ],
      [
        runRecord("run_child_failed", "failed", {
          workflowName: "child",
          workflowVersion: "v1",
          parentRunId: "run_parent_a",
          parentStepId: "workflow:first",
          parentStepName: "first-child",
          parentStepAttempt: 2,
          finishedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
          error: { name: "ChildFailure", message: "child failed" },
        }),
      ],
    );
    reducer.addChildWorkflowAttempts(
      "run_parent_b",
      [
        stepAttempt("run_parent_b", "workflow:second", "second-child", "workflow", {
          childRunId: "run_child_retry",
          workflowName: "child",
          timeoutAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        }),
      ],
      [
        runRecord("run_child_retry", "waiting", {
          workflowName: "child",
          parentRunId: "run_parent_b",
          parentStepId: "workflow:second",
          parentStepName: "second-child",
          parentStepAttempt: 1,
          retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
          retryReason: "workflow",
          retryAttempt: 4,
          retryStepId: "workflow:second",
          retryStepName: "second-child",
        }),
      ],
    );

    expect(reducer.finish()).toMatchObject({
      childWorkflow: {
        activeWaits: 2,
        activeWaitRuns: 2,
        waitRunIds: ["run_parent_a", "run_parent_b"],
        waitStepIds: ["workflow:first", "workflow:second"],
        waitAttemptKeys: [
          "run_parent_a:run:workflow:first:2",
          "run_parent_b:run:workflow:second:1",
        ],
        childRunIds: ["run_child_failed", "run_child_retry"],
        workflows: ["child", "child@v1"],
        childStatus: {
          pending: 0,
          running: 0,
          waiting: 1,
          completed: 0,
          failed: 1,
          canceled: 0,
        },
        retryChildRunIds: ["run_child_retry"],
        failedChildRunIds: ["run_child_failed"],
        childRetry: {
          total: 1,
          retryRunIds: ["run_child_retry"],
          retryStepIds: ["workflow:second"],
          retryStepNames: ["second-child"],
          nextRetryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
          nextRetryRunId: "run_child_retry",
          highestAttempt: 4,
          reason: { workflow: 1, step: 0, missing_implementation: 0 },
        },
        childFailure: {
          total: 1,
          failedRunIds: ["run_child_failed"],
          errors: [
            {
              name: "ChildFailure",
              count: 1,
              failedRunIds: ["run_child_failed"],
              latestFailedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
            },
          ],
          latestFailedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
        },
        oldestWaitStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        nextWaitTimeoutAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        nextWaitTimeoutRunId: "run_parent_b",
        nextWaitTimeoutStepId: "workflow:second",
        nextWaitTimeoutAttemptKey: "run_parent_b:run:workflow:second:1",
      },
    });
  });

  test("does not report a next timeout owner when active child workflow waits have no timeout", () => {
    const reducer = createWorkflowRunChildWorkflowWaitSummaryReducer();

    reducer.addChildWorkflowAttempts(
      "run_parent",
      [
        stepAttempt("run_parent", "workflow:child", "child", "workflow", {
          childRunId: "run_child",
          workflowName: "child",
        }),
      ],
      [],
    );

    expect(reducer.finish()).toEqual({
      childWorkflow: {
        activeWaits: 1,
        activeWaitRuns: 1,
        waitRunIds: ["run_parent"],
        waitStepIds: ["workflow:child"],
        waitAttemptKeys: ["run_parent:run:workflow:child:1"],
        childRunIds: ["run_child"],
        workflows: ["child"],
        childStatus: {
          pending: 0,
          running: 0,
          waiting: 0,
          completed: 0,
          failed: 0,
          canceled: 0,
        },
        oldestWaitStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      },
    });
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

function stepAttempt(
  runId: string,
  stepId: string,
  stepName: string,
  kind: WorkflowStepAttemptRecord["kind"],
  patch: Partial<WorkflowStepAttemptRecord> = {},
): WorkflowStepAttemptRecord {
  const timestamp = Temporal.Instant.from("2026-06-12T09:00:00Z");
  return {
    runId,
    stepId,
    stepName,
    kind,
    status: "running",
    attempt: 1,
    createdAt: timestamp,
    startedAt: timestamp,
    ...patch,
  };
}
