import type { WorkflowRunRecord } from "../../types/run.ts";
import type {
  WorkflowStepAttemptRecord,
  WorkflowStepAttemptSummary,
} from "../../types/step-attempts.ts";

import { makeWorkflowStepAttemptKey } from "../../history/attempt-key.ts";
import { createWorkflowStepAttemptActiveChildWorkflowSummaryReducer } from "./step-attempt-active-child-workflows.ts";
import { createWorkflowStepAttemptActiveMessageWaitSummaryReducer } from "./step-attempt-active-message-waits.ts";
import { createWorkflowStepAttemptActiveSleepSummaryReducer } from "./step-attempt-active-sleeps.ts";
import { createWorkflowStepAttemptBucketSummaryReducer } from "./step-attempt-buckets.ts";
import { createWorkflowStepAttemptFailureSummaryReducer } from "./step-attempt-failure.ts";
import { createWorkflowStepAttemptLifecycleSummaryReducer } from "./step-attempt-lifecycle.ts";

export interface WorkflowStepAttemptSummaryReducer {
  addAttempt(attempt: WorkflowStepAttemptRecord): void;
  finish(): WorkflowStepAttemptSummary;
}

/** Creates a reducer for materialized step attempts and active child workflow records. */
export function createWorkflowStepAttemptSummaryReducer(
  childRuns: readonly WorkflowRunRecord[] = [],
): WorkflowStepAttemptSummaryReducer {
  const buckets = createWorkflowStepAttemptBucketSummaryReducer();
  const lifecycle = createWorkflowStepAttemptLifecycleSummaryReducer();
  const failure = createWorkflowStepAttemptFailureSummaryReducer();
  const sleep = createWorkflowStepAttemptActiveSleepSummaryReducer();
  const childWorkflow = createWorkflowStepAttemptActiveChildWorkflowSummaryReducer();
  const messageWait = createWorkflowStepAttemptActiveMessageWaitSummaryReducer();
  let total = 0;

  return {
    addAttempt(attempt) {
      total++;
      const attemptKey = makeWorkflowStepAttemptKey(attempt.stepId, attempt.attempt);
      buckets.addAttempt(attempt, attemptKey);
      lifecycle.addAttempt(attempt);
      failure.addAttempt(attempt, attemptKey);
      sleep.addAttempt(attempt, attemptKey);
      childWorkflow.addAttempt(attempt, attemptKey);
      messageWait.addAttempt(attempt, attemptKey);
    },
    finish() {
      return {
        total,
        ...buckets.finish(),
        ...lifecycle.finish(),
        ...failure.finish(),
        ...sleep.finish(),
        ...childWorkflow.finish(childRuns),
        ...messageWait.finish(),
      };
    },
  };
}
