import { describe, expect, test } from "vitest";

import type { RunRecord } from "../../types/run.ts";
import type { StepAttemptRecord } from "../../types/step-attempts.ts";

import { summarizeStepAttempts } from "./step-attempts.ts";

describe("workflow step-attempt active sleep summary", () => {
  test("summarizes running sleep attempts and the next sleep", () => {
    const summary = summarizeStepAttempts([
      stepAttempt("run_one", "sleep:later", "later", "sleep", {
        duration: Temporal.Duration.from({ minutes: 10 }),
        status: "running",
        until: Temporal.Instant.from("2026-06-12T10:10:00Z"),
      }),
      stepAttempt("run_one", "sleep:earlier", "earlier", "sleep", {
        duration: Temporal.Duration.from({ minutes: 5 }),
        status: "running",
        until: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      }),
      stepAttempt("run_one", "sleep:completed", "completed", "sleep", {
        status: "completed",
      }),
    ]);

    expect({ sleep: summary.sleep }).toEqual({
      sleep: {
        stepIds: ["sleep:earlier", "sleep:later"],
        attemptKeys: ["run:sleep:earlier:1", "run:sleep:later:1"],
        next: {
          at: Temporal.Instant.from("2026-06-12T10:05:00Z"),
          stepId: "sleep:earlier",
          attemptKey: "run:sleep:earlier:1",
          duration: Temporal.Duration.from({ minutes: 5 }),
        },
      },
    });
  });

  test("does not report a next sleep owner when active sleeps have no wake time", () => {
    const summary = summarizeStepAttempts([
      stepAttempt("run_one", "sleep:active", "active", "sleep", {
        status: "running",
      }),
    ]);

    expect({ sleep: summary.sleep }).toEqual({
      sleep: { stepIds: ["sleep:active"], attemptKeys: ["run:sleep:active:1"] },
    });
  });
});

describe("workflow step-attempt active child workflow summary", () => {
  test("summarizes running child workflow attempts and child run state", () => {
    const summary = summarizeStepAttempts(
      [
        stepAttempt("run_one", "workflow:child", "child", "workflow", {
          childRunId: "child_run",
          startedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
          status: "running",
          timeoutAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
          workflowName: "child-workflow",
          workflowVersion: "v1",
        }),
        stepAttempt("run_one", "workflow:completed", "completed", "workflow", {
          status: "completed",
        }),
      ],
      [
        runRecord("child_run", "waiting", {
          retryAt: Temporal.Instant.from("2026-06-12T09:35:00Z"),
          retryAttempt: 2,
          retryReason: "workflow",
          workflowName: "child-workflow",
          workflowVersion: "v1",
        }),
      ],
    );

    expect({ childWorkflow: summary.childWorkflow }).toEqual({
      childWorkflow: {
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
          count: 1,
          stepNames: [],
          highestAttempt: 2,
          reason: { workflow: 1, step: 0, missing_implementation: 0 },
          next: { at: Temporal.Instant.from("2026-06-12T09:35:00Z"), runId: "child_run" },
        },
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T09:40:00Z"),
          stepId: "workflow:child",
          attemptKey: "run:workflow:child:1",
        },
      },
    });
  });

  test("does not report a next timeout owner when active child workflows have no timeout", () => {
    const summary = summarizeStepAttempts([
      stepAttempt("run_one", "workflow:child", "child", "workflow", {
        childRunId: "child_run",
        workflowName: "child-workflow",
        status: "running",
      }),
    ]);

    expect({ childWorkflow: summary.childWorkflow }).toEqual({
      childWorkflow: {
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

describe("workflow step-attempt active message wait summary", () => {
  test("summarizes running message waits and the next timeout", () => {
    const summary = summarizeStepAttempts([
      stepAttempt("run_one", "message-wait:later", "later", "message-wait", {
        messageId: "approval_later",
        startedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        status: "running",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
      }),
      stepAttempt("run_one", "message-wait:earlier", "earlier", "message-wait", {
        messageId: "approval_earlier",
        startedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        status: "running",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      }),
      stepAttempt("run_one", "message-wait:completed", "completed", "message-wait", {
        status: "completed",
      }),
    ]);

    expect({ message: summary.message }).toEqual({
      message: {
        stepIds: ["message-wait:earlier", "message-wait:later"],
        attemptKeys: ["run:message-wait:earlier:1", "run:message-wait:later:1"],
        messages: ["approval_earlier", "approval_later"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T09:20:00Z"),
          stepId: "message-wait:earlier",
          attemptKey: "run:message-wait:earlier:1",
        },
      },
    });
  });

  test("does not report a next timeout owner when active message waits have no timeout", () => {
    const summary = summarizeStepAttempts([
      stepAttempt("run_one", "message-wait:approval", "approval", "message-wait", {
        messageId: "approval.received",
        status: "running",
      }),
    ]);

    expect({ message: summary.message }).toEqual({
      message: {
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
