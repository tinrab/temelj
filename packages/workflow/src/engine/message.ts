import type { StorageValue } from "@temelj/storage";

import {
  validateStandardSchema as parseStandardSchema,
  type Schema,
} from "@temelj/standard-schema";
import { deepEquals } from "@temelj/value";

import type { ExecutionLimits } from "../types/engine-options.ts";
import type { ExecutionEnvironment } from "../types/engine.ts";
import type { EventRecord, MessageSentEvent } from "../types/events.ts";
import type { MessageId, RunId } from "../types/ids.ts";
import type {
  BroadcastMessageChannelOptions,
  BroadcastMessageInput,
  BroadcastMessageResult,
  SendMessageChannelOptions,
  SendMessageInput,
  SendMessageOptions,
  MessageChannel,
  WaitForMessageOptions,
} from "../types/message.ts";
import type { ListRunsOptions } from "../types/run-list.ts";
import type { RunRecord } from "../types/run.ts";
import type { StepMessageApi } from "../types/step.ts";
import type { WorkflowStore } from "../types/store.ts";
import type { Telemetry, TelemetryContext } from "../types/telemetry.ts";
import type { EngineContext } from "./context.ts";

import { WorkflowStateError } from "../errors/base.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowDurationError, WorkflowReplayDivergenceError } from "../errors/failures.ts";
import {
  WorkflowMessageDeliveryError,
  WorkflowMessageIdempotencyConflictError,
  WorkflowMessageWaitTimeoutError,
} from "../errors/message.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import { type StepIdentity, History } from "../history/replay.ts";
import {
  resolveBroadcastMessageInput,
  resolveSendMessageInput,
  createMessageWait,
} from "../message-options.ts";
import { getRequiredRun } from "../store/query.ts";
import { captureTelemetryContext } from "../telemetry.ts";
import { safeDuration } from "../values.ts";
import {
  resolveCommandIdentity,
  resolveCommandIdentityFromCandidates,
} from "./command-identity.ts";
import { appendDurableStepStartedEvent, appendDurableEvent } from "./durable-command.ts";
import {
  requireMessageSendReplayMatches,
  requireRecordedDurableTerminalStarted,
  recordedInstant,
} from "./replay.ts";
import { enforceEventHistoryNextLimit } from "./retry.ts";
import { serializeError, toOptionalPersistedValue } from "./serialization.ts";
import { Suspended } from "./signals.ts";

const MAX_MESSAGE_DELIVERY_APPEND_ATTEMPTS = 16;

type MessageWaitSource = Extract<EventRecord, { readonly kind: "message_wait_started" }>["source"];

type MessageWaitOptions<TPayload = StorageValue | undefined> = WaitForMessageOptions<
  Schema<unknown, TPayload> | undefined
> & {
  readonly source?: MessageWaitSource;
};

export function createStepMessageApi(environment: ExecutionEnvironment): StepMessageApi {
  const { store, history, now, limits } = environment;

  return {
    async send<TPayload, TRawPayload = TPayload>(
      targetRunId: RunId,
      messageInput: SendMessageInput | MessageChannel<TPayload, TRawPayload>,
      channelOptions?: SendMessageChannelOptions<TRawPayload>,
    ): Promise<void> {
      const options = await resolveSendMessageInput(messageInput, channelOptions);
      const idempotencyKey = options.idempotencyKey;
      const identity = resolveCommandIdentity(history, "message-send", options.messageId);
      const started = history.startedMessageSend(identity.id);
      const completed = history.completedMessageSend(identity.id);

      const nextMessageSend = {
        targetRunId,
        messageId: options.messageId,
        payload: toOptionalPersistedValue(options.payload, "message payload", limits),
        idempotencyKey,
      };

      if (completed !== undefined) {
        requireRecordedDurableTerminalStarted(
          identity,
          history.hasStartedEventBeforeTerminalEvent(completed),
        );
        requireMessageSendReplayMatches(identity, started, completed, nextMessageSend);

        recordedInstant("message-send", identity, "completion", completed.timestamp);

        return;
      }

      const failed = history.failedMessageSend(identity.id);

      if (failed !== undefined) {
        requireRecordedDurableTerminalStarted(
          identity,
          history.hasStartedEventBeforeTerminalEvent(failed),
        );
        requireMessageSendReplayMatches(identity, started, failed, nextMessageSend);

        recordedInstant("message-send", identity, "failure", failed.timestamp);

        throw workflowErrorFromRecord(failed.error);
      }

      if (started === undefined) {
        const timestamp = now();

        const durableEvent: Extract<EventRecord, { kind: "message_send_started" }> = {
          kind: "message_send_started",
          timestamp,
          stepId: identity.id,
          stepName: identity.name,
          count: identity.count,
          targetRunId: nextMessageSend.targetRunId,
          messageId: nextMessageSend.messageId,
          payload: nextMessageSend.payload,
          idempotencyKey: nextMessageSend.idempotencyKey,
        };

        await appendDurableStepStartedEvent(environment, durableEvent);
      } else {
        requireMessageSendReplayMatches(identity, started, started, nextMessageSend);
      }

      try {
        await sendWorkflowMessage(
          store,
          targetRunId,
          {
            ...options,
            idempotencyKey,
          },
          now,
          limits,
          environment.observeMessageSent,
          environment.telemetry,
        );
      } catch (error) {
        await appendDurableEvent(environment, {
          kind: "message_send_failed",
          timestamp: now(),
          stepId: identity.id,
          stepName: identity.name,
          targetRunId,
          messageId: options.messageId,
          error: serializeError(error),
        });
        throw error;
      }

      await appendDurableEvent(environment, {
        kind: "message_send_completed",
        timestamp: now(),
        stepId: identity.id,
        stepName: identity.name,
        targetRunId,
        messageId: options.messageId,
      });
    },

    wait: createMessageWait((options) => waitForMessage(environment, options)),
  };
}

export async function sendMessageInput<TPayload, TRawPayload = TPayload>(
  context: EngineContext,
  runId: RunId,
  messageInput: SendMessageInput | MessageChannel<TPayload, TRawPayload>,
  channelOptions: SendMessageChannelOptions<TRawPayload> | undefined,
): Promise<void> {
  const telemetryContext = captureTelemetryContext(context.telemetry);
  const messageOptions = await resolveSendMessageInput(messageInput, channelOptions);
  await sendWorkflowMessage(
    context.store,
    runId,
    messageOptions,
    context.now,
    context.limits,
    context.observation.emitMessageSent,
    context.telemetry,
    telemetryContext,
  );
}

export async function broadcastMessageInput<TPayload, TRawPayload = TPayload>(
  context: EngineContext,
  messageInput: BroadcastMessageInput | MessageChannel<TPayload, TRawPayload>,
  channelOptions: BroadcastMessageChannelOptions<TRawPayload> | undefined,
): Promise<BroadcastMessageResult> {
  const telemetryContext = captureTelemetryContext(context.telemetry);
  const messageOptions = await resolveBroadcastMessageInput(messageInput, channelOptions);
  toOptionalPersistedValue(messageOptions.payload, "message payload", context.limits);
  const targets = await broadcastMessageTargets(context.store, messageOptions.target);

  for (const target of targets) {
    await sendWorkflowMessage(
      context.store,
      target.id,
      messageOptions,
      context.now,
      context.limits,
      context.observation.emitMessageSent,
      context.telemetry,
      telemetryContext,
    );
  }

  return {
    messageId: messageOptions.messageId,
    runIds: targets.map((target) => target.id),
    deliveredMessages: targets.length,
  };
}

export async function sendWorkflowMessage(
  store: WorkflowStore,
  runId: RunId,
  options: SendMessageOptions,
  now: () => Temporal.Instant,
  limits: ExecutionLimits,
  observeMessageSent?: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "message_sent" }>,
  ) => void,
  telemetry?: Telemetry,
  traceContext?: TelemetryContext,
): Promise<void> {
  const idempotencyKey = options.idempotencyKey;
  const telemetryContext = traceContext ?? captureTelemetryContext(telemetry);
  const run = await getRequiredRun(store, runId);
  const payload = toOptionalPersistedValue(options.payload, "message payload", limits);

  let timestamp: Temporal.Instant | undefined;
  let appendedEvents: readonly EventRecord[] | undefined;

  for (
    let attempt = 0;
    attempt < MAX_MESSAGE_DELIVERY_APPEND_ATTEMPTS && appendedEvents === undefined;
    attempt++
  ) {
    const currentRun = attempt === 0 ? run : await getRequiredRun(store, runId);
    const currentEvents = await store.getEvents(runId);
    const currentHistory = new History(currentEvents);

    if (idempotencyKey !== undefined) {
      const existingMessage = currentHistory.messageByIdempotencyKey(idempotencyKey);

      if (existingMessage !== undefined) {
        if (
          existingMessage.messageId === options.messageId &&
          deepEquals(existingMessage.payload, payload)
        ) {
          await wakeRunForMessageEvent(store, runId, existingMessage);

          return;
        }

        WorkflowMessageIdempotencyConflictError.conflict({
          runId: runId,
          messageId: options.messageId,
          idempotencyKey,
        });
      }

      await requireMessageIdempotencyIndexUnclaimed(
        store,
        runId,
        options.messageId,
        idempotencyKey,
      );
    }

    if (
      currentRun.status === "completed" ||
      currentRun.status === "failed" ||
      currentRun.status === "canceled"
    ) {
      WorkflowMessageDeliveryError.cannotSend({
        runId: runId,
        status: currentRun.status,
        messageId: options.messageId,
      });
    }

    const waiterStepIds = currentHistory.activeMessageWaitStepIds(options.messageId);
    timestamp ??= now();
    enforceEventHistoryNextLimit(currentEvents, limits);

    const durableEvent1: Extract<EventRecord, { kind: "message_sent" }> = {
      kind: "message_sent",
      timestamp,
      messageId: options.messageId,
      payload,
      waiterStepIds: waiterStepIds.length !== 0 ? waiterStepIds : undefined,
      idempotencyKey,
      telemetryContext,
    };

    appendedEvents = await store.appendEventIfRunCurrent(currentRun, durableEvent1);
  }

  if (appendedEvents === undefined) {
    const currentRun = await getRequiredRun(store, runId);

    if (
      currentRun.status === "completed" ||
      currentRun.status === "failed" ||
      currentRun.status === "canceled"
    ) {
      WorkflowMessageDeliveryError.cannotSend({
        runId: runId,
        status: currentRun.status,
        messageId: options.messageId,
      });
    }

    throw new WorkflowStateError(`Failed to append workflow message for run ${runId}`, {
      code: WorkflowErrorCode.STATE_MESSAGE_APPEND_FAILED,
      details: { runId: runId },
    });
  }

  const appendedHistory = new History(appendedEvents);

  if (idempotencyKey !== undefined) {
    const existingMessage = appendedHistory.messageByIdempotencyKey(idempotencyKey);

    if (
      existingMessage !== undefined &&
      !workflowMessageSendMatches(existingMessage, options, payload)
    ) {
      WorkflowMessageIdempotencyConflictError.conflict({
        runId: runId,
        messageId: options.messageId,
        idempotencyKey,
      });
    }
  }

  let messageEvent = appendedHistory.messageForSend(options.messageId, idempotencyKey);

  if (messageEvent === undefined) {
    const fallback: MessageSentEvent = {
      kind: "message_sent",
      timestamp: timestamp ?? now(),
      messageId: options.messageId,
      payload,
      telemetryContext,
    };

    messageEvent = fallback;
  }

  observeMessageSent?.(runId, messageEvent);
  await wakeRunForMessageEvent(store, runId, messageEvent);
}

async function broadcastMessageTargets(
  store: WorkflowStore,
  target: ListRunsOptions | undefined,
): Promise<readonly RunRecord[]> {
  const runs = await store.listRuns(target);

  return runs.filter(
    (run) => !(run.status === "completed" || run.status === "failed" || run.status === "canceled"),
  );
}

async function requireMessageIdempotencyIndexUnclaimed(
  store: WorkflowStore,
  runId: RunId,
  messageId: MessageId,
  idempotencyKey: string,
): Promise<void> {
  if (await store.hasMessageIdempotencyKey(runId, idempotencyKey)) {
    WorkflowMessageIdempotencyConflictError.conflict({
      runId,
      messageId,
      idempotencyKey,
    });
  }
}

function workflowMessageSendMatches(
  event: MessageSentEvent,
  options: SendMessageOptions,
  payload: StorageValue | undefined,
): boolean {
  return event.messageId === options.messageId && deepEquals(event.payload, payload);
}

export async function waitForMessage<TPayload = never>(
  environment: ExecutionEnvironment,
  options: MessageWaitOptions<TPayload>,
): Promise<TPayload | StorageValue | undefined> {
  const { runId, history, now, executionOwner } = environment;

  const identity = resolveCommandIdentityFromCandidates(
    history,
    "message-wait",
    [options.commandId, options.name, options.messageId],
    "Workflow message commandId, name, or messageId",
  );

  const started = history.startedMessageWait(identity.id);
  const completed = history.completedMessageWait(identity.id);

  if (completed !== undefined) {
    requireRecordedDurableTerminalStarted(
      identity,
      history.hasStartedEventBeforeTerminalEvent(completed),
    );
    requireMessageWaitReplayMatches(identity, started, completed, options);

    return options.schema === undefined
      ? completed.payload
      : await parseStandardSchema(
          options.schema,
          completed.payload,
          "Workflow message validation failed",
        );
  }

  const failed = history.failedMessageWait(identity.id);

  if (failed !== undefined) {
    requireRecordedDurableTerminalStarted(
      identity,
      history.hasStartedEventBeforeTerminalEvent(failed),
    );
    requireMessageWaitReplayMatches(identity, started, failed, options);
    throw workflowErrorFromRecord(failed.error);
  }

  if (started !== undefined) {
    requireMessageWaitReplayMatches(identity, started, started, options);
  }

  const timeoutAt =
    started?.timeoutAt === undefined
      ? options.timeout === undefined
        ? undefined
        : (() => {
            const timeout = safeDuration(
              options.timeout.total({ unit: "millisecond" }),
              "Workflow messageId timeout",
            );

            if (timeout <= 0) {
              throw new WorkflowDurationError("Workflow message timeout must be greater than zero");
            }

            return now().add(Temporal.Duration.from({ milliseconds: timeout }));
          })()
      : recordedInstant("message-wait", identity, "timeout", started.timeoutAt);

  let waitStartedAt: Temporal.Instant | undefined;

  if (started === undefined) {
    waitStartedAt = now();

    const durableEvent2: Extract<EventRecord, { kind: "message_wait_started" }> = {
      kind: "message_wait_started",
      timestamp: waitStartedAt,
      stepId: identity.id,
      stepName: identity.name,
      count: identity.count,
      messageId: options.messageId,
      source: options.source,
      timeoutAt,
    };

    await appendDurableStepStartedEvent(environment, durableEvent2);
  }

  const messageId = history.messageForWait(options.messageId, identity.id, timeoutAt);

  if (messageId !== undefined) {
    let payload: TPayload | StorageValue | undefined;

    try {
      payload =
        options.schema === undefined
          ? messageId.payload
          : await parseStandardSchema(
              options.schema,
              messageId.payload,
              "Workflow message validation failed",
            );
    } catch (error) {
      await appendDurableEvent(environment, {
        kind: "message_wait_failed",
        timestamp: now(),
        stepId: identity.id,
        stepName: identity.name,
        messageId: options.messageId,
        error: serializeError(error),
      });
      throw error;
    }

    // Replay validates the original input again, so schema transforms run once per execution.
    const persistedPayload = messageId.payload;

    const durableEvent3: Extract<EventRecord, { kind: "message_wait_completed" }> = {
      kind: "message_wait_completed",
      timestamp: now(),
      stepId: identity.id,
      stepName: identity.name,
      messageId: options.messageId,
      payload: persistedPayload,
      messageTimestamp: messageId.timestamp,
      telemetryContext: messageId.telemetryContext,
    };

    await appendDurableEvent(environment, durableEvent3);

    return payload;
  }

  if (timeoutAt !== undefined && Temporal.Instant.compare(timeoutAt, now()) <= 0) {
    const error = new WorkflowMessageWaitTimeoutError({
      runId,
      stepId: identity.id,
      stepName: identity.name,
      messageId: options.messageId,
      timeoutAt,
    });

    await appendDurableEvent(environment, {
      kind: "message_wait_failed",
      timestamp: now(),
      stepId: identity.id,
      stepName: identity.name,
      messageId: options.messageId,
      error: serializeError(error),
    });
    throw error;
  }

  Suspended.until(messageWaitAvailableAt(now, timeoutAt, executionOwner.deadlineAt));
}

function requireMessageWaitReplayMatches(
  identity: StepIdentity,
  started: Extract<EventRecord, { readonly kind: "message_wait_started" }> | undefined,
  event: Extract<
    EventRecord,
    { readonly kind: "message_wait_started" | "message_wait_completed" | "message_wait_failed" }
  >,
  options: Omit<MessageWaitOptions, "schema">,
): void {
  const recordedMessage = started?.messageId ?? event.messageId;

  if (started !== undefined) {
    recordedInstant("message-wait", identity, "start", started.timestamp);
  }

  if (recordedMessage !== options.messageId) {
    WorkflowReplayDivergenceError.atStep(
      identity.id,
      `recorded message-wait step ${identity.id} waited for ${recordedMessage}, ` +
        `but replay waited for ${options.messageId}`,
    );
  }

  if (started !== undefined && started.source !== options.source) {
    const recordedSource = started.source ?? "message";
    const replaySource = options.source ?? "message";
    WorkflowReplayDivergenceError.atStep(
      identity.id,
      `recorded message-wait step ${identity.id} was created by ${recordedSource}, ` +
        `but replay used ${replaySource}`,
    );
  }

  if (
    started !== undefined &&
    (started.timeoutAt === undefined) !== (options.timeout === undefined)
  ) {
    const recordedTimeout = started.timeoutAt === undefined ? "no timeout" : started.timeoutAt;
    const replayTimeout = options.timeout === undefined ? "no timeout" : "a timeout";
    WorkflowReplayDivergenceError.atStep(
      identity.id,
      `recorded message-wait step ${identity.id} had ${String(recordedTimeout)}, ` +
        `but replay used ${replayTimeout}`,
    );
  }

  if (event.kind === "message_wait_completed") {
    recordedInstant("message-wait", identity, "messageId", event.messageTimestamp);
  }
}

function messageWaitAvailableAt(
  now: () => Temporal.Instant,
  timeoutAt: Temporal.Instant | undefined,
  deadlineAt: Temporal.Instant | undefined,
): Temporal.Instant {
  const candidates = [timeoutAt, deadlineAt]
    .filter((value): value is Temporal.Instant => value !== undefined)
    .sort((left, right) => Temporal.Instant.compare(left, right));

  return candidates[0] ?? now().add(Temporal.Duration.from({ milliseconds: 2 ** 31 - 1 }));
}

async function wakeRunForMessageEvent(
  store: WorkflowStore,
  runId: RunId,
  messageEvent: Extract<EventRecord, { readonly kind: "message_sent" }>,
): Promise<void> {
  const run = await store.getRun(runId);

  if (run === undefined || run.status !== "waiting") {
    return;
  }

  const events = await store.getEvents(runId);
  const activeWaits = new History(events).activeMessageWaitStepIds(messageEvent.messageId);

  const hasActiveWait =
    messageEvent.waiterStepIds === undefined
      ? activeWaits.length > 0
      : activeWaits.some((stepId) => messageEvent.waiterStepIds?.includes(stepId));

  if (!hasActiveWait) {
    return;
  }

  await store.updateRunIfCurrent(run, {
    ...run,
    availableAt:
      run.availableAt !== undefined &&
      Temporal.Instant.compare(run.availableAt, messageEvent.timestamp) <= 0
        ? run.availableAt
        : messageEvent.timestamp,
    updatedAt: messageEvent.timestamp,
    lastTransitionAt: messageEvent.timestamp,
    lastTransitionReason: "waiting",
    error: undefined,
    output: undefined,
    finishedAt: undefined,
  });
}
