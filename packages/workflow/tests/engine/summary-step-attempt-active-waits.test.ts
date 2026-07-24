import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../src/types/step-attempts.ts";

import { createWorkflowStepAttemptActiveChildWorkflowSummaryReducer } from "../../src/engine/summary/step-attempt-active-child-workflows.ts";
import { createWorkflowStepAttemptActiveMessageWaitSummaryReducer } from "../../src/engine/summary/step-attempt-active-message-waits.ts";
import { createWorkflowStepAttemptActiveSleepSummaryReducer } from "../../src/engine/summary/step-attempt-active-sleeps.ts";

describe("workflow step-attempt active sleep summary reducer", () => {
  test("summarizes running sleep attempts and the next sleep", () => {
    const reducer = createWorkflowStepAttemptActiveSleepSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "sleep:later", "later", "sleep", {
        duration: Temporal.Duration.from({ minutes: 10 }),
        status: "running",
        until: Temporal.Instant.from("2026-06-12T10:10:00Z"),
      }),
      "run:sleep:later:1",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "sleep:earlier", "earlier", "sleep", {
        duration: Temporal.Duration.from({ minutes: 5 }),
        status: "running",
        until: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      }),
      "run:sleep:earlier:1",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "sleep:completed", "completed", "sleep", {
        status: "completed",
      }),
      "run:sleep:completed:1",
    );

    expect(reducer.finish()).toEqual({
      activeSleepStepIds: ["sleep:earlier", "sleep:later"],
      activeSleepAttemptKeys: ["run:sleep:earlier:1", "run:sleep:later:1"],
      nextSleepUntil: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      nextSleepStepId: "sleep:earlier",
      nextSleepAttemptKey: "run:sleep:earlier:1",
      nextSleepDuration: Temporal.Duration.from({ minutes: 5 }),
    });
  });

  test("does not report a next sleep owner when active sleeps have no wake time", () => {
    const reducer = createWorkflowStepAttemptActiveSleepSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "sleep:active", "active", "sleep", {
        status: "running",
      }),
      "run:sleep:active:1",
    );

    expect(reducer.finish()).toEqual({
      activeSleepStepIds: ["sleep:active"],
      activeSleepAttemptKeys: ["run:sleep:active:1"],
    });
  });
});

describe("workflow step-attempt active child workflow summary reducer", () => {
  test("summarizes running child workflow attempts and child run state", () => {
    const reducer = createWorkflowStepAttemptActiveChildWorkflowSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "workflow:child", "child", "workflow", {
        childRunId: "child_run",
        startedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
        status: "running",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
        workflowName: "child-workflow",
        workflowVersion: "v1",
      }),
      "run:workflow:child:1",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "workflow:completed", "completed", "workflow", {
        status: "completed",
      }),
      "run:workflow:completed:1",
    );

    expect(
      reducer.finish([
        runRecord("child_run", "waiting", {
          retryAt: Temporal.Instant.from("2026-06-12T09:35:00Z"),
          retryAttempt: 2,
          retryReason: "workflow",
          workflowName: "child-workflow",
          workflowVersion: "v1",
        }),
      ]),
    ).toEqual({
      activeChildWorkflows: {
        total: 1,
        stepIds: ["workflow:child"],
        attemptKeys: ["run:workflow:child:1"],
        childRunIds: ["child_run"],
        workflows: ["child-workflow@v1"],
        childStatus: {
          pending: 0,
          running: 0,
          waiting: 1,
          completed: 0,
          failed: 0,
          canceled: 0,
        },
        retryChildRunIds: ["child_run"],
        childRetry: {
          total: 1,
          retryRunIds: ["child_run"],
          retryStepIds: [],
          retryStepNames: [],
          nextRetryAt: Temporal.Instant.from("2026-06-12T09:35:00Z"),
          nextRetryRunId: "child_run",
          highestAttempt: 2,
          reason: { workflow: 1, step: 0, missing_implementation: 0 },
        },
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
        nextTimeoutAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
        nextTimeoutStepId: "workflow:child",
        nextTimeoutAttemptKey: "run:workflow:child:1",
      },
    });
  });

  test("does not report a next timeout owner when active child workflows have no timeout", () => {
    const reducer = createWorkflowStepAttemptActiveChildWorkflowSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "workflow:child", "child", "workflow", {
        childRunId: "child_run",
        workflowName: "child-workflow",
        status: "running",
      }),
      "run:workflow:child:1",
    );

    expect(reducer.finish()).toEqual({
      activeChildWorkflows: {
        total: 1,
        stepIds: ["workflow:child"],
        attemptKeys: ["run:workflow:child:1"],
        childRunIds: ["child_run"],
        workflows: ["child-workflow"],
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

describe("workflow step-attempt active message wait summary reducer", () => {
  test("summarizes running message waits and the next timeout", () => {
    const reducer = createWorkflowStepAttemptActiveMessageWaitSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "message-wait:later", "later", "message-wait", {
        messageId: "approval_later",
        startedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        status: "running",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
      }),
      "run:message-wait:later:1",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "message-wait:earlier", "earlier", "message-wait", {
        messageId: "approval_earlier",
        startedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        status: "running",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      }),
      "run:message-wait:earlier:1",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "message-wait:completed", "completed", "message-wait", {
        status: "completed",
      }),
      "run:message-wait:completed:1",
    );

    expect(reducer.finish()).toEqual({
      activeMessageWaits: {
        total: 2,
        stepIds: ["message-wait:earlier", "message-wait:later"],
        attemptKeys: ["run:message-wait:earlier:1", "run:message-wait:later:1"],
        messages: ["approval_earlier", "approval_later"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        nextTimeoutAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
        nextTimeoutStepId: "message-wait:earlier",
        nextTimeoutAttemptKey: "run:message-wait:earlier:1",
      },
    });
  });

  test("does not report a next timeout owner when active message waits have no timeout", () => {
    const reducer = createWorkflowStepAttemptActiveMessageWaitSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "message-wait:approval", "approval", "message-wait", {
        messageId: "approval.received",
        status: "running",
      }),
      "run:message-wait:approval:1",
    );

    expect(reducer.finish()).toEqual({
      activeMessageWaits: {
        total: 1,
        stepIds: ["message-wait:approval"],
        attemptKeys: ["run:message-wait:approval:1"],
        messages: ["approval.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
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
