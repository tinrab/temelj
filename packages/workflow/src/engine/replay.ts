import type { StorageValue } from "@temelj/storage";

import { deepEquals } from "@temelj/value";

import type { ExecutionEnvironment } from "../types/engine.ts";
import type { SleepStartedEvent, EventRecord } from "../types/events.ts";
import type { RunId, MessageId } from "../types/ids.ts";
import type { AttributePatch } from "../types/run.ts";
import type { StepRunConfig } from "../types/step.ts";

import { workflowAttributePatchFromEvent } from "../attributes.ts";
import { WorkflowReplayDivergenceError } from "../errors/mod.ts";
import { type StepIdentity } from "../history/replay.ts";
import { resolveCommandIdentity } from "./command-identity.ts";
import { appendDurableStepStartedEvent, appendDurableEvent } from "./durable-command.ts";
import { Suspended } from "./signals.ts";

export function isRunStepTerminalForStartedAttempt(
  terminal: Extract<EventRecord, { readonly kind: "step_completed" | "step_failed" }>,
  started: Extract<EventRecord, { readonly kind: "step_started" }>,
): boolean {
  return terminal.attempt === started.attempt;
}

export function requireRecordedDurableStepStarted(identity: StepIdentity, started: boolean): void {
  if (started) {
    return;
  }

  WorkflowReplayDivergenceError.atStep(
    identity.id,
    `recorded ${identity.kind} step ${identity.id} has a terminal event without a started event`,
  );
}

export function requireRecordedDurableTerminalStarted(
  identity: StepIdentity,
  hasStartedEventBeforeTerminal: boolean,
): void {
  requireRecordedDurableStepStarted(identity, hasStartedEventBeforeTerminal);
}

export function requireRunStepReplayTimeoutMatches(
  identity: StepIdentity,
  started: Extract<EventRecord, { readonly kind: "step_started" }> | undefined,
  config: StepRunConfig,
): void {
  if (
    started === undefined ||
    (started.timeoutAt === undefined) === (config.timeout === undefined)
  ) {
    return;
  }

  const recordedTimeout =
    started.timeoutAt === undefined ? "no timeout" : started.timeoutAt.toString();

  const replayTimeout = config.timeout === undefined ? "no timeout" : "a timeout";
  WorkflowReplayDivergenceError.atStep(
    identity.id,
    `recorded run step ${identity.id} had ${recordedTimeout}, ` +
      `but replay used ${replayTimeout}`,
  );
}

export function requireMetadataReplayMatches(
  identity: StepIdentity,
  recorded: Extract<EventRecord, { readonly kind: "metadata_set" }>,
  metadata: StorageValue,
): void {
  if (deepEquals(recorded.metadata, metadata)) {
    return;
  }

  WorkflowReplayDivergenceError.diverged(
    `recorded metadata step ${identity.id} used different metadata`,
    {
      expectedStepId: identity.id,
      actualStepId: recorded.stepId,
    },
  );
}

export function requireAttributesReplayMatches(
  identity: StepIdentity,
  recorded: Extract<EventRecord, { readonly kind: "attributes_set" }>,
  attributes: AttributePatch,
): void {
  if (JSON.stringify(workflowAttributePatchFromEvent(recorded)) === JSON.stringify(attributes)) {
    return;
  }

  WorkflowReplayDivergenceError.diverged(
    `recorded attributes step ${identity.id} used different attributes`,
    {
      expectedStepId: identity.id,
      actualStepId: recorded.stepId,
    },
  );
}

export function requireMessageSendReplayMatches(
  identity: StepIdentity,
  started: Extract<EventRecord, { readonly kind: "message_send_started" }> | undefined,
  terminal: Extract<
    EventRecord,
    { readonly kind: "message_send_started" | "message_send_completed" | "message_send_failed" }
  >,
  next: {
    readonly targetRunId: RunId;
    readonly messageId: MessageId;
    readonly payload?: StorageValue;
    readonly idempotencyKey?: string;
  },
): void {
  // A message send is an external side effect.
  // Replay must reuse the recorded target/message instead of sending a new logical message when user code reaches this step again.
  const recordedTargetRunId = started?.targetRunId ?? terminal.targetRunId;
  const recordedMessage = started?.messageId ?? terminal.messageId;
  const recordedPayload = started?.payload;
  const recordedIdempotencyKey = started?.idempotencyKey;

  if (
    recordedTargetRunId === next.targetRunId &&
    recordedMessage === next.messageId &&
    deepEquals(recordedPayload, next.payload) &&
    recordedIdempotencyKey === next.idempotencyKey
  ) {
    return;
  }

  const message =
    recordedTargetRunId === next.targetRunId && recordedMessage === next.messageId
      ? `recorded message-send step ${identity.id} targeted ${recordedTargetRunId} ` +
        `messageId ${recordedMessage} with different payload or idempotency key`
      : `recorded message-send step ${identity.id} targeted ${recordedTargetRunId} ` +
        `messageId ${recordedMessage}, but replay targeted ${next.targetRunId} messageId ${next.messageId}`;

  WorkflowReplayDivergenceError.atStep(identity.id, message);
}

export async function sleepUntil(
  environment: ExecutionEnvironment,
  name: string,
  initialUntil: Temporal.Instant,
  options: { readonly duration?: Temporal.Duration },
): Promise<void> {
  const { history, now } = environment;
  const identity = resolveCommandIdentity(history, "sleep", name);
  const started = history.startedSleep(identity.id);
  const completed = history.completedSleep(identity.id);

  if (completed !== undefined) {
    // Completed sleeps never wait during replay, but we still validate the recorded wait shape so a code change cannot silently reinterpret old history.
    requireRecordedDurableStepStarted(
      identity,
      history.hasStartedEventBeforeTerminalEvent(completed),
    );
    requireSleepReplayMatches(identity, started, initialUntil, options);

    recordedInstant("sleep", identity, "completion", completed.timestamp);

    return;
  }

  const until =
    started === undefined
      ? initialUntil
      : recordedInstant("sleep", identity, "wake", started.until);

  requireSleepReplayMatches(identity, started, initialUntil, options);

  if (started === undefined) {
    const event: SleepStartedEvent = {
      kind: "sleep_started",
      timestamp: now(),
      stepId: identity.id,
      stepName: identity.name,
      count: identity.count,
      until,
      duration: options.duration,
    };

    await appendDurableStepStartedEvent(environment, event);
  }

  if (Temporal.Instant.compare(until, now()) > 0) {
    // Suspension is the durable wait mechanism: the run transitions to waiting and a worker will resume it after the stored wake time.
    Suspended.until(until);
  }

  await appendDurableEvent(environment, {
    kind: "sleep_completed",
    timestamp: now(),
    stepId: identity.id,
    stepName: identity.name,
  });
}

function requireSleepReplayMatches(
  identity: StepIdentity,
  started: Extract<EventRecord, { readonly kind: "sleep_started" }> | undefined,
  until: Temporal.Instant,
  options: { readonly duration?: Temporal.Duration },
): void {
  if (started === undefined) {
    return;
  }

  if (started.duration !== undefined || options.duration !== undefined) {
    if (started.duration === undefined || options.duration === undefined) {
      if (started.duration === options.duration) {
        return;
      }
    } else if (started.duration.toString() === options.duration.toString()) {
      return;
    }

    WorkflowReplayDivergenceError.atStep(
      identity.id,
      `recorded sleep step ${identity.id} waited for ${String(started.duration)}ms, ` +
        `but replay waited for ${String(options.duration)}ms`,
    );
  }

  if (Temporal.Instant.compare(started.until, until) === 0) {
    return;
  }

  WorkflowReplayDivergenceError.atStep(
    identity.id,
    `recorded sleep step ${identity.id} waited until ${started.until.toString()}, ` +
      `but replay waited until ${until.toString()}`,
  );
}

/** A timestamp read from history; anything else in its place is a replay divergence. */
export function recordedInstant(
  kind: string,
  identity: StepIdentity,
  label: string,
  value: Temporal.Instant,
): Temporal.Instant {
  if (value instanceof Temporal.Instant) {
    return value;
  }

  WorkflowReplayDivergenceError.atStep(
    identity.id,
    `recorded ${kind} step ${identity.id} has invalid ${label} timestamp: ${String(value)}`,
  );
}
