import type { StorageValue } from "@temelj/storage";

import {
  validateStandardSchema as parseStandardSchema,
  type Schema,
} from "@temelj/standard-schema";
import { deepEquals } from "@temelj/value";

import type { WorkflowExecutionLimits } from "../types/engine-options.ts";
import type { WorkflowExecutionEnvironment } from "../types/engine.ts";
import type { EventRecord, MessageSentEvent, MessageSentPayload } from "../types/events.ts";
import type {
  BroadcastMessageChannelOptions,
  BroadcastMessageInput,
  BroadcastMessageResult,
  SendMessageChannelOptions,
  SendMessageInput,
  SendMessageOptions,
  MessageChannel,
  WaitForMessageOptions,
  MessageId,
} from "../types/message.ts";
import type { WorkflowListRunsOptions } from "../types/run-list.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type {
  WorkflowConditionalEventAppender,
  WorkflowEventReader,
  WorkflowMessageIdempotencyIndexLookup,
  WorkflowRunConditionalWriterRepository,
  WorkflowRunListerRepository,
  WorkflowRunReaderRepository,
} from "../types/store.ts";
import type { Telemetry, TelemetryContext } from "../types/telemetry.ts";

import { WorkflowStateError } from "../errors/base.ts";
import { WorkflowDurationError, WorkflowReplayDivergenceError } from "../errors/failures.ts";
import {
  WorkflowMessageDeliveryError,
  WorkflowMessageIdempotencyConflictError,
  WorkflowMessageWaitTimeoutError,
} from "../errors/message.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import { type WorkflowStepIdentity, WorkflowHistory } from "../history/mod.ts";
import {
  resolveBroadcastMessageInput,
  resolveSendMessageInput,
  createWorkflowMessageWait,
} from "../message-options.ts";
import { captureTelemetryContext } from "../telemetry.ts";
import { WorkflowStepMessageApi } from "../types/step.ts";
import { safeDuration } from "../utility.ts";
import {
  resolveWorkflowCommandIdentity,
  resolveWorkflowCommandIdentityFromCandidates,
} from "./command-identity.ts";
import {
  appendDurableStepStartedEvent,
  appendDurableStepTerminalEvent,
} from "./durable-command.ts";
import {
  requireMessageSendReplayMatches,
  requireRecordedDurableTerminalStarted,
} from "./replay.ts";
import { enforceWorkflowEventHistoryNextLimit } from "./retry.ts";
import { serializeError, toOptionalPersistedValue } from "./serialization.ts";
import { getRequiredRun, WorkflowSuspended } from "./state.ts";

const MAX_MESSAGE_DELIVERY_APPEND_ATTEMPTS = 16;

type MessageWaitSource = Extract<EventRecord, { readonly kind: "message_wait_started" }>["source"];

type WorkflowMessageWaitOptions<TPayload = StorageValue | undefined> = WaitForMessageOptions<
  Schema<unknown, TPayload> | undefined
> & {
  readonly source?: MessageWaitSource;
};

type WorkflowMessageDeliveryStore = WorkflowMessageIdempotencyIndexLookup &
  WorkflowRunReaderRepository &
  WorkflowEventReader &
  WorkflowConditionalEventAppender &
  WorkflowRunConditionalWriterRepository;

type WorkflowMessageStore = WorkflowMessageDeliveryStore & WorkflowRunListerRepository;

interface WorkflowMessageServiceOptions {
  readonly store: WorkflowMessageStore;
  readonly now: () => Temporal.Instant;
  readonly limits: WorkflowExecutionLimits;
  readonly observeMessageSent?: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "message_sent" }>,
  ) => void;
  readonly telemetry?: Telemetry;
}

export function createWorkflowStepMessageApi(
  environment: WorkflowExecutionEnvironment,
): WorkflowStepMessageApi {
  const { store, history, now, limits } = environment;

  return {
    async send<TPayload, TRawPayload = TPayload>(
      targetRunId: RunId,
      messageInput: SendMessageInput | MessageChannel<TPayload, TRawPayload>,
      channelOptions?: SendMessageChannelOptions<TRawPayload>,
    ): Promise<void> {
      const options = await resolveSendMessageInput(messageInput, channelOptions);
      const idempotencyKey = options.idempotencyKey;
      const identity = resolveWorkflowCommandIdentity(history, "message-send", options.messageId);
      const started = history.startedMessageSend(identity.id);
      const completed = history.completedMessageSend(identity.id);

      if (completed !== undefined) {
        requireRecordedDurableTerminalStarted(
          identity,
          history.hasStartedEventBeforeTerminalEvent(completed),
        );
        requireMessageSendReplayMatches(identity, started, completed, {
          targetRunId,
          messageId: options.messageId,
          payload: toOptionalPersistedValue(options.payload, "message payload", limits),
          idempotencyKey,
        });

        if (!(completed.timestamp instanceof Temporal.Instant)) {
          WorkflowReplayDivergenceError.diverged(
            `recorded message-send step ${identity.id} has invalid completion timestamp: ` +
              String(completed.timestamp),
            {
              expectedStepId: identity.id,
              actualStepId: identity.id,
            },
          );
        }

        return;
      }

      const failed = history.failedMessageSend(identity.id);

      if (failed !== undefined) {
        requireRecordedDurableTerminalStarted(
          identity,
          history.hasStartedEventBeforeTerminalEvent(failed),
        );
        requireMessageSendReplayMatches(identity, started, failed, {
          targetRunId,
          messageId: options.messageId,
          payload: toOptionalPersistedValue(options.payload, "message payload", limits),
          idempotencyKey,
        });

        if (!(failed.timestamp instanceof Temporal.Instant)) {
          WorkflowReplayDivergenceError.diverged(
            `recorded message-send step ${identity.id} has invalid failure timestamp: ` +
              String(failed.timestamp),
            {
              expectedStepId: identity.id,
              actualStepId: identity.id,
            },
          );
        }

        throw workflowErrorFromRecord(failed.error);
      }

      const nextMessageSend = {
        targetRunId,
        messageId: options.messageId,
        payload: toOptionalPersistedValue(options.payload, "message payload", limits),
        idempotencyKey,
      };

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
        };

        if (nextMessageSend.idempotencyKey !== undefined) {
          Object.assign(durableEvent, {
            idempotencyKey: nextMessageSend.idempotencyKey,
          } satisfies Partial<Extract<EventRecord, { kind: "message_send_started" }>>);
        }

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
        await appendDurableStepTerminalEvent(environment, {
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

      await appendDurableStepTerminalEvent(environment, {
        kind: "message_send_completed",
        timestamp: now(),
        stepId: identity.id,
        stepName: identity.name,
        targetRunId,
        messageId: options.messageId,
      });
    },

    wait: createWorkflowMessageWait((options) => waitForWorkflowMessage(environment, options)),
  };
}

export async function sendWorkflowMessageInput<TPayload, TRawPayload = TPayload>(
  service: WorkflowMessageServiceOptions,
  runId: RunId,
  messageInput: SendMessageInput | MessageChannel<TPayload, TRawPayload>,
  channelOptions: SendMessageChannelOptions<TRawPayload> | undefined,
): Promise<void> {
  const telemetryContext = captureTelemetryContext(service.telemetry);
  const messageOptions = await resolveSendMessageInput(messageInput, channelOptions);
  await sendWorkflowMessage(
    service.store,
    runId,
    messageOptions,
    service.now,
    service.limits,
    service.observeMessageSent,
    service.telemetry,
    telemetryContext,
  );
}

export async function broadcastWorkflowMessageInput<TPayload, TRawPayload = TPayload>(
  service: WorkflowMessageServiceOptions,
  messageInput: BroadcastMessageInput | MessageChannel<TPayload, TRawPayload>,
  channelOptions: BroadcastMessageChannelOptions<TRawPayload> | undefined,
): Promise<BroadcastMessageResult> {
  const telemetryContext = captureTelemetryContext(service.telemetry);
  const messageOptions = await resolveBroadcastMessageInput(messageInput, channelOptions);
  toOptionalPersistedValue(messageOptions.payload, "message payload", service.limits);
  const targets = await broadcastMessageTargets(service.store, messageOptions.target);

  for (const target of targets) {
    await sendWorkflowMessage(
      service.store,
      target.id,
      messageOptions,
      service.now,
      service.limits,
      service.observeMessageSent,
      service.telemetry,
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
  store: WorkflowMessageDeliveryStore,
  runId: RunId,
  options: SendMessageOptions,
  now: () => Temporal.Instant,
  limits: WorkflowExecutionLimits,
  observeMessageSent?: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "message_sent" }>,
  ) => void,
  telemetry?: Telemetry,
  traceContext?: TelemetryContext,
): Promise<void> {
  const targetRunId = runId;
  const idempotencyKey = options.idempotencyKey;
  const telemetryContext = traceContext ?? captureTelemetryContext(telemetry);
  const run = await getRequiredRun(store, targetRunId);
  const payload = toOptionalPersistedValue(options.payload, "message payload", limits);

  let timestamp: Temporal.Instant | undefined;
  let appendedEvents: readonly EventRecord[] | undefined;

  for (
    let attempt = 0;
    attempt < MAX_MESSAGE_DELIVERY_APPEND_ATTEMPTS && appendedEvents === undefined;
    attempt++
  ) {
    const currentRun = attempt === 0 ? run : await getRequiredRun(store, targetRunId);
    const currentEvents = await store.getEvents(targetRunId);
    const currentHistory = new WorkflowHistory(currentEvents);

    if (idempotencyKey !== undefined) {
      const existingMessage = currentHistory.messageByIdempotencyKey(idempotencyKey);

      if (existingMessage !== undefined) {
        if (
          existingMessage.messageId === options.messageId &&
          deepEquals(existingMessage.payload, payload)
        ) {
          await wakeRunForMessageEvent(store, targetRunId, existingMessage);

          return;
        }

        WorkflowMessageIdempotencyConflictError.conflict({
          runId: targetRunId,
          messageId: options.messageId,
          idempotencyKey,
        });
      }

      await requireMessageIdempotencyIndexUnclaimed(
        store,
        targetRunId,
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
        runId: targetRunId,
        status: currentRun.status,
        messageId: options.messageId,
      });
    }

    const waiterStepIds = currentHistory.activeMessageWaitStepIds(options.messageId);
    timestamp ??= now();
    enforceWorkflowEventHistoryNextLimit(currentEvents, limits);

    const durableEvent1: Extract<EventRecord, { kind: "message_sent" }> = {
      kind: "message_sent",
      timestamp,
      messageId: options.messageId,
      payload,
    };

    if (waiterStepIds.length !== 0) {
      Object.assign(durableEvent1, { waiterStepIds } satisfies Partial<
        Extract<EventRecord, { kind: "message_sent" }>
      >);
    }

    if (idempotencyKey !== undefined) {
      Object.assign(durableEvent1, { idempotencyKey } satisfies Partial<
        Extract<EventRecord, { kind: "message_sent" }>
      >);
    }

    if (telemetryContext !== undefined) {
      Object.assign(durableEvent1, { telemetryContext } satisfies Partial<
        Extract<EventRecord, { kind: "message_sent" }>
      >);
    }

    appendedEvents = await store.appendEventIfRunCurrent(currentRun, durableEvent1);
  }

  if (appendedEvents === undefined) {
    const currentRun = await getRequiredRun(store, targetRunId);

    if (
      currentRun.status === "completed" ||
      currentRun.status === "failed" ||
      currentRun.status === "canceled"
    ) {
      WorkflowMessageDeliveryError.cannotSend({
        runId: targetRunId,
        status: currentRun.status,
        messageId: options.messageId,
      });
    }

    WorkflowStateError.failedMessageAppend(targetRunId);
  }

  const appendedHistory = new WorkflowHistory(appendedEvents);

  if (idempotencyKey !== undefined) {
    const existingMessage = appendedHistory.messageByIdempotencyKey(idempotencyKey);

    if (
      existingMessage !== undefined &&
      !workflowMessageSendMatches(existingMessage, options, payload)
    ) {
      WorkflowMessageIdempotencyConflictError.conflict({
        runId: targetRunId,
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
    };

    if (telemetryContext !== undefined) {
      Object.assign(fallback, { telemetryContext } satisfies Partial<MessageSentEvent>);
    }

    messageEvent = fallback;
  }

  observeMessageSent?.(targetRunId, messageEvent);
  await wakeRunForMessageEvent(store, targetRunId, messageEvent);
}

async function broadcastMessageTargets(
  store: WorkflowRunListerRepository,
  target: WorkflowListRunsOptions | undefined,
): Promise<readonly WorkflowRunRecord[]> {
  const runs = await store.listRuns(target);

  return runs.filter(
    (run) => !(run.status === "completed" || run.status === "failed" || run.status === "canceled"),
  );
}

async function requireMessageIdempotencyIndexUnclaimed(
  store: WorkflowMessageIdempotencyIndexLookup,
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
  payload: MessageSentPayload | undefined,
): boolean {
  return event.messageId === options.messageId && deepEquals(event.payload, payload);
}

export async function waitForWorkflowMessage<TPayload = never>(
  environment: WorkflowExecutionEnvironment,
  options: WorkflowMessageWaitOptions<TPayload>,
): Promise<TPayload | StorageValue | undefined> {
  const { runId, history, now, executionOwner } = environment;

  const identity = resolveWorkflowCommandIdentityFromCandidates(
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
              WorkflowDurationError.signalTimeoutPositive();
            }

            return now().add(Temporal.Duration.from({ milliseconds: timeout }));
          })()
      : (() => {
          if (!(started.timeoutAt instanceof Temporal.Instant)) {
            WorkflowReplayDivergenceError.diverged(
              `recorded message-wait step ${identity.id} has invalid timeout timestamp: ` +
                String(started.timeoutAt),
              {
                expectedStepId: identity.id,
                actualStepId: identity.id,
              },
            );
          }

          return started.timeoutAt;
        })();

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
    };

    if (options.source !== undefined) {
      Object.assign(durableEvent2, { source: options.source } satisfies Partial<
        Extract<EventRecord, { kind: "message_wait_started" }>
      >);
    }

    if (timeoutAt !== undefined) {
      Object.assign(durableEvent2, { timeoutAt } satisfies Partial<
        Extract<EventRecord, { kind: "message_wait_started" }>
      >);
    }

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
      await appendDurableStepTerminalEvent(environment, {
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

    const result = {
      kind: "message_wait_completed",
      timestamp: now(),
      stepId: identity.id,
      stepName: identity.name,
      messageId: options.messageId,
    } satisfies Partial<Extract<EventRecord, { kind: "message_wait_completed" }>>;

    if (persistedPayload !== undefined) {
      Object.assign(result, { payload: persistedPayload } satisfies Partial<
        Extract<EventRecord, { kind: "message_wait_completed" }>
      >);
    }

    const result1 = Object.assign(result, {
      messageTimestamp: messageId.timestamp,
    } satisfies Partial<Extract<EventRecord, { kind: "message_wait_completed" }>>);

    if (messageId.telemetryContext !== undefined) {
      Object.assign(result1, { telemetryContext: messageId.telemetryContext } satisfies Partial<
        Extract<EventRecord, { kind: "message_wait_completed" }>
      >);
    }

    const durableEvent3: Extract<EventRecord, { kind: "message_wait_completed" }> = result1;
    await appendDurableStepTerminalEvent(environment, durableEvent3);

    return payload;
  }

  if (timeoutAt !== undefined && Temporal.Instant.compare(timeoutAt, now()) <= 0) {
    const error = WorkflowMessageWaitTimeoutError.create({
      runId,
      stepId: identity.id,
      stepName: identity.name,
      messageId: options.messageId,
      timeoutAt,
    });

    await appendDurableStepTerminalEvent(environment, {
      kind: "message_wait_failed",
      timestamp: now(),
      stepId: identity.id,
      stepName: identity.name,
      messageId: options.messageId,
      error: serializeError(error),
    });
    throw error;
  }

  WorkflowSuspended.until(messageWaitAvailableAt(now, timeoutAt, executionOwner.deadlineAt));
}

export function requireMessageWaitReplayMatches(
  identity: WorkflowStepIdentity,
  started: Extract<EventRecord, { readonly kind: "message_wait_started" }> | undefined,
  event: Extract<
    EventRecord,
    { readonly kind: "message_wait_started" | "message_wait_completed" | "message_wait_failed" }
  >,
  options: Omit<WorkflowMessageWaitOptions, "schema">,
): void {
  const recordedMessage = started?.messageId ?? event.messageId;

  if (started !== undefined && !(started.timestamp instanceof Temporal.Instant)) {
    WorkflowReplayDivergenceError.diverged(
      `recorded message-wait step ${identity.id} has invalid start timestamp: ` +
        String(started.timestamp),
      {
        expectedStepId: identity.id,
        actualStepId: identity.id,
      },
    );
  }

  if (recordedMessage !== options.messageId) {
    WorkflowReplayDivergenceError.diverged(
      `recorded message-wait step ${identity.id} waited for ${recordedMessage}, ` +
        `but replay waited for ${options.messageId}`,
      {
        expectedStepId: identity.id,
        actualStepId: identity.id,
      },
    );
  }

  if (started !== undefined && started.source !== options.source) {
    const recordedSource = started.source ?? "message";
    const replaySource = options.source ?? "message";
    WorkflowReplayDivergenceError.diverged(
      `recorded message-wait step ${identity.id} was created by ${recordedSource}, ` +
        `but replay used ${replaySource}`,
      {
        expectedStepId: identity.id,
        actualStepId: identity.id,
      },
    );
  }

  if (
    started !== undefined &&
    (started.timeoutAt === undefined) !== (options.timeout === undefined)
  ) {
    const recordedTimeout = started.timeoutAt === undefined ? "no timeout" : started.timeoutAt;
    const replayTimeout = options.timeout === undefined ? "no timeout" : "a timeout";
    WorkflowReplayDivergenceError.diverged(
      `recorded message-wait step ${identity.id} had ${String(recordedTimeout)}, ` +
        `but replay used ${replayTimeout}`,
      {
        expectedStepId: identity.id,
        actualStepId: identity.id,
      },
    );
  }

  if (
    event.kind === "message_wait_completed" &&
    !(event.messageTimestamp instanceof Temporal.Instant)
  ) {
    WorkflowReplayDivergenceError.diverged(
      `recorded message-wait step ${identity.id} has invalid messageId timestamp: ` +
        String(event.messageTimestamp),
      {
        expectedStepId: identity.id,
        actualStepId: identity.id,
      },
    );
  }
}

export function messageWaitAvailableAt(
  now: () => Temporal.Instant,
  timeoutAt: Temporal.Instant | undefined,
  deadlineAt: Temporal.Instant | undefined,
): Temporal.Instant {
  const candidates = [timeoutAt, deadlineAt]
    .filter((value): value is Temporal.Instant => value !== undefined)
    .sort((left, right) => Temporal.Instant.compare(left, right));

  return candidates[0] ?? now().add(Temporal.Duration.from({ milliseconds: 2 ** 31 - 1 }));
}

export async function wakeRunForMessageEvent(
  store: WorkflowRunReaderRepository & WorkflowEventReader & WorkflowRunConditionalWriterRepository,
  runId: RunId,
  messageEvent: Extract<EventRecord, { readonly kind: "message_sent" }>,
): Promise<void> {
  const run = await store.getRun(runId);

  if (run === undefined || run.status !== "waiting") {
    return;
  }

  const events = await store.getEvents(runId);
  const activeWaits = new WorkflowHistory(events).activeMessageWaitStepIds(messageEvent.messageId);

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
    deadlineAt: run.deadlineAt,
    retryAt: run.retryAt,
    error: undefined,
    output: undefined,
    finishedAt: undefined,
  });
}
