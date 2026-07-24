import type { WorkflowMaterializedStepType } from "../../types/run.ts";
import type {
  WorkflowStepAttemptRecord,
  WorkflowStepAttemptStatus,
} from "../../types/step-attempts.ts";

type WorkflowStepAttemptStatusAttemptKeys = Record<WorkflowStepAttemptStatus, string[]>;
type WorkflowStepAttemptStatusCounts = Record<WorkflowStepAttemptStatus, number>;
type WorkflowStepAttemptStatusStepIds = Record<WorkflowStepAttemptStatus, string[]>;
type WorkflowStepAttemptKindAttemptKeys = Record<WorkflowMaterializedStepType, string[]>;
type WorkflowStepAttemptKindCounts = Record<WorkflowMaterializedStepType, number>;
type WorkflowStepAttemptKindStepIds = Record<WorkflowMaterializedStepType, string[]>;

export interface WorkflowStepAttemptStatusSummaryFields {
  readonly status: WorkflowStepAttemptStatusCounts;
  readonly statusStepIds: Record<WorkflowStepAttemptStatus, readonly string[]>;
  readonly statusAttemptKeys: Record<WorkflowStepAttemptStatus, readonly string[]>;
}

export interface WorkflowStepAttemptKindSummaryFields {
  readonly kind: WorkflowStepAttemptKindCounts;
  readonly kindStepIds: Record<WorkflowMaterializedStepType, readonly string[]>;
  readonly kindAttemptKeys: Record<WorkflowMaterializedStepType, readonly string[]>;
}

export interface WorkflowStepAttemptBucketSummaryReducer {
  addAttempt(attempt: WorkflowStepAttemptRecord, attemptKey: string): void;
  finish(): WorkflowStepAttemptStatusSummaryFields & WorkflowStepAttemptKindSummaryFields;
}

interface WorkflowStepAttemptStatusAccumulator {
  readonly attemptKeys: WorkflowStepAttemptStatusAttemptKeys;
  readonly status: WorkflowStepAttemptStatusCounts;
  readonly stepIds: WorkflowStepAttemptStatusStepIds;
}

interface WorkflowStepAttemptKindAccumulator {
  readonly attemptKeys: WorkflowStepAttemptKindAttemptKeys;
  readonly kind: WorkflowStepAttemptKindCounts;
  readonly stepIds: WorkflowStepAttemptKindStepIds;
}

export function createWorkflowStepAttemptBucketSummaryReducer(): WorkflowStepAttemptBucketSummaryReducer {
  const status = createWorkflowStepAttemptStatusAccumulator();
  const kind = createWorkflowStepAttemptKindAccumulator();
  return {
    addAttempt(attempt, attemptKey) {
      addWorkflowStepAttemptStatus(status, attempt, attemptKey);
      addWorkflowStepAttemptKind(kind, attempt, attemptKey);
    },
    finish() {
      return {
        ...finishWorkflowStepAttemptStatusSummary(status),
        ...finishWorkflowStepAttemptKindSummary(kind),
      };
    },
  };
}

function createWorkflowStepAttemptStatusAccumulator(): WorkflowStepAttemptStatusAccumulator {
  return {
    attemptKeys: createWorkflowStepAttemptStatusAttemptKeys(),
    status: createWorkflowStepAttemptStatusCounts(),
    stepIds: createWorkflowStepAttemptStatusStepIds(),
  };
}

function createWorkflowStepAttemptKindAccumulator(): WorkflowStepAttemptKindAccumulator {
  return {
    attemptKeys: createWorkflowStepAttemptKindAttemptKeys(),
    kind: createWorkflowStepAttemptKindCounts(),
    stepIds: createWorkflowStepAttemptKindStepIds(),
  };
}

function addWorkflowStepAttemptStatus(
  status: WorkflowStepAttemptStatusAccumulator,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  status.status[attempt.status]++;
  status.stepIds[attempt.status].push(attempt.stepId);
  status.attemptKeys[attempt.status].push(attemptKey);
}

function addWorkflowStepAttemptKind(
  kind: WorkflowStepAttemptKindAccumulator,
  attempt: WorkflowStepAttemptRecord,
  attemptKey: string,
): void {
  kind.kind[attempt.kind]++;
  kind.stepIds[attempt.kind].push(attempt.stepId);
  kind.attemptKeys[attempt.kind].push(attemptKey);
}

function finishWorkflowStepAttemptStatusSummary(
  status: WorkflowStepAttemptStatusAccumulator,
): WorkflowStepAttemptStatusSummaryFields {
  return {
    status: status.status,
    statusStepIds: sortedWorkflowStepAttemptStatusStepIds(status.stepIds),
    statusAttemptKeys: sortedWorkflowStepAttemptStatusAttemptKeys(status.attemptKeys),
  };
}

function finishWorkflowStepAttemptKindSummary(
  kind: WorkflowStepAttemptKindAccumulator,
): WorkflowStepAttemptKindSummaryFields {
  return {
    kind: kind.kind,
    kindStepIds: sortedWorkflowStepAttemptKindStepIds(kind.stepIds),
    kindAttemptKeys: sortedWorkflowStepAttemptKindAttemptKeys(kind.attemptKeys),
  };
}

function createWorkflowStepAttemptStatusCounts(): WorkflowStepAttemptStatusCounts {
  return {
    running: 0,
    completed: 0,
    failed: 0,
    abandoned: 0,
  };
}

function createWorkflowStepAttemptStatusStepIds(): WorkflowStepAttemptStatusStepIds {
  return {
    running: [],
    completed: [],
    failed: [],
    abandoned: [],
  };
}

function sortedWorkflowStepAttemptStatusStepIds(
  stepIds: WorkflowStepAttemptStatusStepIds,
): Record<WorkflowStepAttemptStatus, readonly string[]> {
  return {
    running: [...stepIds.running].sort(),
    completed: [...stepIds.completed].sort(),
    failed: [...stepIds.failed].sort(),
    abandoned: [...stepIds.abandoned].sort(),
  };
}

function createWorkflowStepAttemptStatusAttemptKeys(): WorkflowStepAttemptStatusAttemptKeys {
  return {
    running: [],
    completed: [],
    failed: [],
    abandoned: [],
  };
}

function sortedWorkflowStepAttemptStatusAttemptKeys(
  attemptKeys: WorkflowStepAttemptStatusAttemptKeys,
): Record<WorkflowStepAttemptStatus, readonly string[]> {
  return {
    running: [...attemptKeys.running].sort(),
    completed: [...attemptKeys.completed].sort(),
    failed: [...attemptKeys.failed].sort(),
    abandoned: [...attemptKeys.abandoned].sort(),
  };
}

function createWorkflowStepAttemptKindCounts(): WorkflowStepAttemptKindCounts {
  return {
    run: 0,
    sleep: 0,
    workflow: 0,
    "message-send": 0,
    "message-wait": 0,
    stream: 0,
    deterministic: 0,
  };
}

function createWorkflowStepAttemptKindStepIds(): WorkflowStepAttemptKindStepIds {
  return {
    run: [],
    sleep: [],
    workflow: [],
    "message-send": [],
    "message-wait": [],
    stream: [],
    deterministic: [],
  };
}

function createWorkflowStepAttemptKindAttemptKeys(): WorkflowStepAttemptKindAttemptKeys {
  return {
    run: [],
    sleep: [],
    workflow: [],
    "message-send": [],
    "message-wait": [],
    stream: [],
    deterministic: [],
  };
}

function sortedWorkflowStepAttemptKindAttemptKeys(
  attemptKeys: WorkflowStepAttemptKindAttemptKeys,
): Record<WorkflowMaterializedStepType, readonly string[]> {
  return {
    run: [...attemptKeys.run].sort(),
    sleep: [...attemptKeys.sleep].sort(),
    workflow: [...attemptKeys.workflow].sort(),
    "message-send": [...attemptKeys["message-send"]].sort(),
    "message-wait": [...attemptKeys["message-wait"]].sort(),
    stream: [...attemptKeys.stream].sort(),
    deterministic: [...attemptKeys.deterministic].sort(),
  };
}

function sortedWorkflowStepAttemptKindStepIds(
  stepIds: WorkflowStepAttemptKindStepIds,
): Record<WorkflowMaterializedStepType, readonly string[]> {
  return {
    run: [...stepIds.run].sort(),
    sleep: [...stepIds.sleep].sort(),
    workflow: [...stepIds.workflow].sort(),
    "message-send": [...stepIds["message-send"]].sort(),
    "message-wait": [...stepIds["message-wait"]].sort(),
    stream: [...stepIds.stream].sort(),
    deterministic: [...stepIds.deterministic].sort(),
  };
}
