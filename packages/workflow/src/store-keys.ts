import type { WorkflowIdempotencyKeyOptions } from "./types/store.ts";

import { makeWorkflowStepAttemptKey } from "./history/attempt-key.ts";
import { RunId } from "./types/run.ts";
import { ScheduleId } from "./types/schedule.ts";

export type WorkflowIdempotencyKey = `workflow:${string}:idempotency:${string}:${string}`;
export type MessageIdempotencyKey = `workflow:${string}:message-idempotency:${string}:${string}`;
export type WorkflowRunKey = `workflow:${string}:run:${string}`;
export type WorkflowEventsKey = `workflow:${string}:events:${string}`;
export type WorkflowStepAttemptKey = `workflow:${string}:step-attempt:${string}:${string}`;
export type WorkflowScheduleKey = `workflow:${string}:schedule:${string}`;
export type WorkflowLockKey = `workflow:${string}:lock:${string}`;
export type WorkflowCleanupMarkerKey = `workflow:${string}:cleanup:${string}`;

export type WorkflowNamespacePrefix = `workflow:${string}:`;
export type WorkflowRunKeyPrefix = `workflow:${string}:run:`;
export type WorkflowStepAttemptKeyPrefix = `workflow:${string}:step-attempt:${string}:`;
export type WorkflowScheduleKeyPrefix = `workflow:${string}:schedule:`;
export type WorkflowLockKeyPrefix = `workflow:${string}:lock:`;
export type WorkflowCleanupMarkerKeyPrefix = `workflow:${string}:cleanup:`;

/** Builds a validated workflow idempotency storage key. */
export function makeWorkflowIdempotencyKey(
  namespace: string,
  options: WorkflowIdempotencyKeyOptions,
): WorkflowIdempotencyKey {
  return makeIdempotencyKey(namespace, options);
}

/** Builds a workflow run storage key. */
export function makeRunKey(namespace: string, runId: RunId): WorkflowRunKey {
  return `${namespacePrefix(namespace)}run:${runId}`;
}

/** Builds a workflow event-history storage key. */
export function makeEventsKey(namespace: string, runId: RunId): WorkflowEventsKey {
  return `${namespacePrefix(namespace)}events:${runId}`;
}

/** Builds a workflow step-attempt storage key. */
export function makeStepAttemptKey(
  namespace: string,
  runId: RunId,
  attemptKey: string,
): WorkflowStepAttemptKey {
  return `${makeStepAttemptKeyPrefix(namespace, runId)}${encodeURIComponent(attemptKey)}`;
}

/** Builds a workflow step-attempt storage key prefix. */
export function makeStepAttemptKeyPrefix(
  namespace: string,
  runId: RunId,
): WorkflowStepAttemptKeyPrefix {
  return `${namespacePrefix(namespace)}step-attempt:${runId}:`;
}

export function isStepAttemptKey(key: string, namespace: string, runId: RunId): boolean {
  const prefix = makeStepAttemptKeyPrefix(namespace, runId);
  if (!key.startsWith(prefix)) {
    return false;
  }
  const attemptKey = decodeStepAttemptKey(key, prefix);
  if (attemptKey === undefined) {
    return false;
  }
  const separator = attemptKey.lastIndexOf(":");
  if (!attemptKey.startsWith("run:") || separator <= "run:".length) {
    return false;
  }
  const stepId = attemptKey.slice("run:".length, separator);
  const attempt = Number(attemptKey.slice(separator + 1));
  try {
    return makeWorkflowStepAttemptKey(stepId, attempt) === attemptKey;
  } catch {
    return false;
  }
}

function decodeStepAttemptKey(key: string, prefix: string): string | undefined {
  try {
    return decodeURIComponent(key.slice(prefix.length));
  } catch {
    return undefined;
  }
}

/** Builds a workflow message idempotency storage key. */
export function makeMessageIdempotencyKey(
  namespace: string,
  runId: RunId,
  idempotencyKey: string,
): MessageIdempotencyKey {
  return `${namespacePrefix(namespace)}message-idempotency:${encodeURIComponent(
    runId,
  )}:${encodeURIComponent(idempotencyKey)}`;
}

/** Builds a workflow schedule storage key. */
export function makeScheduleKey(namespace: string, scheduleId: ScheduleId): WorkflowScheduleKey {
  return `${namespacePrefix(namespace)}schedule:${encodeURIComponent(scheduleId)}`;
}

/** Builds a workflow schedule storage key prefix. */
export function makeScheduleKeyPrefix(namespace: string): WorkflowScheduleKeyPrefix {
  return `${namespacePrefix(namespace)}schedule:`;
}

/** Builds a workflow lock storage key. */
export function makeLockKey(namespace: string, key: string): WorkflowLockKey {
  return `${namespacePrefix(namespace)}lock:${encodeURIComponent(key)}`;
}

/** Builds a workflow cleanup marker storage key. */
export function makeCleanupMarkerKey(namespace: string, runId: RunId): WorkflowCleanupMarkerKey {
  return `${namespacePrefix(namespace)}cleanup:${encodeURIComponent(runId)}`;
}

/** Builds a workflow cleanup marker storage key prefix. */
export function makeCleanupMarkerKeyPrefix(namespace: string): WorkflowCleanupMarkerKeyPrefix {
  return `${namespacePrefix(namespace)}cleanup:`;
}

/** Builds a workflow lock storage key prefix. */
export function makeLockKeyPrefix(namespace: string): WorkflowLockKeyPrefix {
  return `${namespacePrefix(namespace)}lock:`;
}

/** Builds a workflow idempotency storage key. */
export function makeIdempotencyKey(
  namespace: string,
  options: WorkflowIdempotencyKeyOptions,
): WorkflowIdempotencyKey {
  const versionedName =
    options.workflowVersion === undefined
      ? options.workflowName
      : `${options.workflowName}@${options.workflowVersion}`;
  return `${namespacePrefix(namespace)}idempotency:${encodeURIComponent(
    versionedName,
  )}:${encodeURIComponent(options.idempotencyKey)}`;
}

/** Builds a workflow run storage key prefix. */
export function makeRunKeyPrefix(namespace: string): WorkflowRunKeyPrefix {
  return `${namespacePrefix(namespace)}run:`;
}

function namespacePrefix(namespace: string): WorkflowNamespacePrefix {
  return `workflow:${encodeURIComponent(namespace)}:`;
}
