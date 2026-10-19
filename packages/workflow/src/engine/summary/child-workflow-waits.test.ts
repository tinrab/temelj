import { describe, expect, test } from "vitest";

import type { RunRecord } from "../../types/run.ts";
import type { StepAttemptRecord } from "../../types/step-attempts.ts";

import { summarizeRuns } from "./runs.ts";

describe("workflow run child workflow wait summary", () => {
  test("summarizes child workflow run state independently from wait aggregation", () => {
    const childRuns = [
      runRecord("run_child_retry", "waiting", {
        workflowName: "child",
        retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        retryReason: "workflow",
        retryAttempt: 4,
        retryStepId: "workflow:second",
        retryStepName: "second-child",
      }),
      runRecord("run_child_failed", "failed", {
        workflowName: "child",
        finishedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
        error: { name: "ChildFailure", message: "child failed" },
      }),
      runRecord("run_child_canceled", "canceled", {
        workflowName: "child",
        finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      }),
    ];

    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [],
      runningChildWorkflows: [
        {
          runId: "run_parent",
          attempts: [stepAttempt("run_parent", "workflow:child", "child", "workflow", {})],
          childRuns,
        },
      ],
    });

    expect(summary.childWorkflow).toMatchObject({
      childStatus: {
        pending: 0,
        running: 0,
        waiting: 1,
        completed: 0,
        failed: 1,
        canceled: 1,
      },
      childRetry: {
        count: 1,
        stepNames: ["second-child"],
        highestAttempt: 4,
        reason: { workflow: 1, step: 0, missing_implementation: 0 },
        next: { at: Temporal.Instant.from("2026-06-12T10:05:00Z"), runId: "run_child_retry" },
      },
      childFailure: {
        count: 1,
        errors: [
          {
            name: "ChildFailure",
            count: 1,
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
      },
    });
  });

  test("summarizes active child workflow waits and child run state", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [],
      runningChildWorkflows: [
        {
          runId: "run_parent_a",
          attempts: [
            stepAttempt("run_parent_a", "workflow:first", "first-child", "workflow", {
              attempt: 2,
              childRunId: "run_child_failed",
              workflowName: "child",
              workflowVersion: "v1",
              timeoutAt: Temporal.Instant.from("2026-06-12T10:40:00Z"),
            }),
          ],
          childRuns: [
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
        },
        {
          runId: "run_parent_b",
          attempts: [
            stepAttempt("run_parent_b", "workflow:second", "second-child", "workflow", {
              childRunId: "run_child_retry",
              workflowName: "child",
              timeoutAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
            }),
          ],
          childRuns: [
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
        },
      ],
    });

    expect({ childWorkflow: summary.childWorkflow }).toMatchObject({
      childWorkflow: {
        count: 2,
        workflows: ["child", "child@v1"],
        childStatus: {
          pending: 0,
          running: 0,
          waiting: 1,
          completed: 0,
          failed: 1,
          canceled: 0,
        },
        childRetry: {
          count: 1,
          stepNames: ["second-child"],
          highestAttempt: 4,
          reason: { workflow: 1, step: 0, missing_implementation: 0 },
          next: { at: Temporal.Instant.from("2026-06-12T10:05:00Z"), runId: "run_child_retry" },
        },
        childFailure: {
          count: 1,
          errors: [
            {
              name: "ChildFailure",
              count: 1,
              latestFailedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
            },
          ],
          latestFailedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
        },
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T10:20:00Z"),
          runId: "run_parent_b",
          stepId: "workflow:second",
          attemptKey: "run_parent_b:run:workflow:second:1",
        },
      },
    });
  });

  test("does not report a next timeout owner when active child workflow waits have no timeout", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [],
      runningChildWorkflows: [
        {
          runId: "run_parent",
          attempts: [
            stepAttempt("run_parent", "workflow:child", "child", "workflow", {
              childRunId: "run_child",
              workflowName: "child",
            }),
          ],
          childRuns: [],
        },
      ],
    });

    expect({ childWorkflow: summary.childWorkflow }).toEqual({
      childWorkflow: {
        count: 1,
        workflows: ["child"],
        childStatus: {
          pending: 0,
          running: 0,
          waiting: 0,
          completed: 0,
          failed: 0,
          canceled: 0,
        },
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
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

function stepAttempt(
  runId: string,
  stepId: string,
  stepName: string,
  kind: StepAttemptRecord["kind"],
  patch: Partial<StepAttemptRecord> = {},
): StepAttemptRecord {
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
