import type { RunId, StepId } from "./types/ids.ts";
import type { ScheduleId } from "./types/schedule.ts";
import type { StepAttemptRecord } from "./types/step-attempts.ts";
import type { IdempotencyKeyOptions } from "./types/store.ts";

/** The key of one step attempt within a run, such as `run:step_1:2`. */
export function stepAttemptKey(stepId: StepId, attempt: number): string {
  return `run:${stepId}:${attempt}`;
}

export type IdempotencyKey = `workflow:${string}:idempotency:${string}:${string}`;

export type MessageIdempotencyKey = `workflow:${string}:message-idempotency:${string}:${string}`;

type RunKey = `workflow:${string}:run:${string}`;

export type EventsKey = `workflow:${string}:events:${string}`;

type StepAttemptKey = `workflow:${string}:step-attempt:${string}:${string}`;

type ScheduleKey = `workflow:${string}:schedule:${string}`;

type LockKey = `workflow:${string}:lock:${string}`;

type CleanupMarkerKey = `workflow:${string}:cleanup:${string}`;

type NamespacePrefix = `workflow:${string}:`;

type RunKeyPrefix = `workflow:${string}:run:`;

type StepAttemptKeyPrefix = `workflow:${string}:step-attempt:${string}:`;

type ScheduleKeyPrefix = `workflow:${string}:schedule:`;

type LockKeyPrefix = `workflow:${string}:lock:`;

type CleanupMarkerKeyPrefix = `workflow:${string}:cleanup:`;

export function makeWorkflowIdempotencyKey(
  namespace: string,
  options: IdempotencyKeyOptions,
): IdempotencyKey {
  return makeIdempotencyKey(namespace, options);
}

export function makeRunKey(namespace: string, runId: RunId): RunKey {
  return `${namespacePrefix(namespace)}run:${runId}`;
}

export function makeEventsKey(namespace: string, runId: RunId): EventsKey {
  return `${namespacePrefix(namespace)}events:${runId}`;
}

export function makeStepAttemptKey(
  namespace: string,
  runId: RunId,
  attemptKey: string,
): StepAttemptKey {
  return `${makeStepAttemptKeyPrefix(namespace, runId)}${encodeURIComponent(attemptKey)}`;
}

export function makeStepAttemptKeyPrefix(namespace: string, runId: RunId): StepAttemptKeyPrefix {
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
    return stepAttemptKey(stepId, attempt) === attemptKey;
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

export function makeMessageIdempotencyKey(
  namespace: string,
  runId: RunId,
  idempotencyKey: string,
): MessageIdempotencyKey {
  return `${namespacePrefix(namespace)}message-idempotency:${encodeURIComponent(
    runId,
  )}:${encodeURIComponent(idempotencyKey)}`;
}

export function makeScheduleKey(namespace: string, scheduleId: ScheduleId): ScheduleKey {
  return `${namespacePrefix(namespace)}schedule:${encodeURIComponent(scheduleId)}`;
}

export function makeScheduleKeyPrefix(namespace: string): ScheduleKeyPrefix {
  return `${namespacePrefix(namespace)}schedule:`;
}

export function makeLockKey(namespace: string, key: string): LockKey {
  return `${namespacePrefix(namespace)}lock:${encodeURIComponent(key)}`;
}

export function makeCleanupMarkerKey(namespace: string, runId: RunId): CleanupMarkerKey {
  return `${namespacePrefix(namespace)}cleanup:${encodeURIComponent(runId)}`;
}

export function makeCleanupMarkerKeyPrefix(namespace: string): CleanupMarkerKeyPrefix {
  return `${namespacePrefix(namespace)}cleanup:`;
}

export function makeLockKeyPrefix(namespace: string): LockKeyPrefix {
  return `${namespacePrefix(namespace)}lock:`;
}

export function makeIdempotencyKey(
  namespace: string,
  options: IdempotencyKeyOptions,
): IdempotencyKey {
  const versionedName =
    options.workflowVersion === undefined
      ? options.workflowName
      : `${options.workflowName}@${options.workflowVersion}`;

  return `${namespacePrefix(namespace)}idempotency:${encodeURIComponent(
    versionedName,
  )}:${encodeURIComponent(options.idempotencyKey)}`;
}

export function makeRunKeyPrefix(namespace: string): RunKeyPrefix {
  return `${namespacePrefix(namespace)}run:`;
}

function namespacePrefix(namespace: string): NamespacePrefix {
  return `workflow:${encodeURIComponent(namespace)}:`;
}

export function runStepAttemptKey(runId: RunId, attempt: StepAttemptRecord): string {
  return `${runId}:${stepAttemptKey(attempt.stepId, attempt.attempt)}`;
}
