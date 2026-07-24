import type { StorageValue } from "@temelj/storage";

import { encodeBase64UrlString } from "@temelj/string";

import type { WorkflowExecutionLimits } from "../types/engine-options.ts";
import type { WorkflowExecutionEnvironment } from "../types/engine.ts";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { EventRecord } from "../types/events.ts";
import type {
  CreateHookOptions,
  CreateWebhookOptions,
  Hook as HookContract,
  HookInspectionStatus,
  HookKind,
  HookInspection,
  ParsedWorkflowHookToken,
  HookTokenPayload,
  ResumeHookOptions,
  Webhook as WebhookContract,
} from "../types/hook.ts";
import type { RunId, WorkflowRunRecord } from "../types/run.ts";
import type { WorkflowStepHookApi } from "../types/step.ts";
import type {
  WorkflowConditionalEventAppender,
  WorkflowEventReader,
  WorkflowMessageIdempotencyIndexLookup,
  WorkflowRunConditionalWriterRepository,
  WorkflowRunReaderRepository,
} from "../types/store.ts";
import type { Telemetry, TelemetryContext } from "../types/telemetry.ts";

import { WorkflowHookDisposedError, WorkflowHookError } from "../errors/mod.ts";
import { WorkflowHistory } from "../history/mod.ts";
import { captureTelemetryContext } from "../telemetry.ts";
import {
  WORKFLOW_HOOK_TOKEN_PREFIX,
  WORKFLOW_HOOK_TOKEN_VERSION,
  parseHookToken,
  parseWebhookToken,
} from "../types/hook.ts";
import { MessageId } from "../types/message-id.ts";
import { sendWorkflowMessage, waitForWorkflowMessage } from "./message.ts";
import { enforceWorkflowEventHistoryNextLimit } from "./retry.ts";
import { serializeError, toOptionalPersistedValue, toPersistedValue } from "./serialization.ts";

const MAX_HOOK_DISPOSAL_APPEND_ATTEMPTS = 16;

type WorkflowHookStore = WorkflowMessageIdempotencyIndexLookup &
  WorkflowRunReaderRepository &
  WorkflowEventReader &
  WorkflowConditionalEventAppender &
  WorkflowRunConditionalWriterRepository;

interface WorkflowHookServiceOptions {
  readonly store: WorkflowHookStore;
  readonly now: () => Temporal.Instant;
  readonly limits: WorkflowExecutionLimits;
  readonly emitMessageSent: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "message_sent" }>,
  ) => void;
  readonly emitHookResumed: (
    runId: RunId,
    messageId: MessageId,
    payload: StorageValue | undefined,
    traceContext: TelemetryContext | undefined,
  ) => void;
  readonly emitWebhookResumed: (
    runId: RunId,
    messageId: MessageId,
    payload: StorageValue | undefined,
    traceContext: TelemetryContext | undefined,
  ) => void;
  readonly telemetry?: Telemetry;
}

export function createHook<TPayload>(
  runId: RunId,
  options: CreateHookOptions,
  wait: () => Promise<unknown>,
): HookContract<TPayload> {
  return new Hook(runId, options, wait);
}

export function createWebhook<TPayload>(
  runId: RunId,
  options: CreateWebhookOptions,
  wait: () => Promise<unknown>,
): WebhookContract<TPayload> {
  return new Webhook(runId, options, wait);
}

export function createWorkflowStepHookApi(
  environment: WorkflowExecutionEnvironment,
): WorkflowStepHookApi {
  const { runId } = environment;
  const tokens = new Set<string>();
  return {
    create<TPayload = unknown>(options: CreateHookOptions): HookContract<TPayload> {
      const hook = createHook<TPayload>(runId, options, async () => {
        return await waitForWorkflowMessage(environment, {
          commandId: options.commandId ?? options.name,
          messageId: options.messageId ?? options.name,
          source: "hook",
          ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
          ...(options.schema === undefined ? {} : { schema: options.schema }),
        });
      });
      requireUniqueWorkflowStepHookToken(tokens, "hook", hook.name, hook.token);
      return hook;
    },

    createWebhook<TPayload = unknown>(options: CreateWebhookOptions): WebhookContract<TPayload> {
      const webhook = createWebhook<TPayload>(runId, options, async () => {
        return await waitForWorkflowMessage(environment, {
          commandId: options.commandId ?? options.name,
          messageId: options.messageId ?? options.name,
          source: "webhook",
          ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
          ...(options.schema === undefined ? {} : { schema: options.schema }),
        });
      });
      requireUniqueWorkflowStepHookToken(tokens, "webhook", webhook.name, webhook.token);
      return webhook;
    },
  };
}

export class Hook<TPayload> implements HookContract<TPayload> {
  readonly token: string;
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: MessageId;

  readonly #wait: () => Promise<unknown>;

  constructor(runId: RunId, options: CreateHookOptions, wait: () => Promise<unknown>) {
    const messageId = options.messageId ?? options.name;
    this.token = formatHookToken({
      runId,
      name: options.name,
      messageId: messageId,
    });
    this.runId = runId;
    this.name = options.name;
    this.messageId = messageId;
    this.#wait = wait;
  }

  async wait(): Promise<TPayload> {
    return (await this.#wait()) as TPayload;
  }

  // oxlint-disable-next-line unicorn/no-thenable -- Workflow hooks intentionally support await hook.
  then<TResult1 = TPayload, TResult2 = never>(
    onfulfilled?: ((value: TPayload) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.wait().then(onfulfilled, onrejected);
  }
}

function requireUniqueWorkflowStepHookToken(
  tokens: Set<string>,
  kind: "hook" | "webhook",
  name: string,
  token: string,
): void {
  if (tokens.has(token)) {
    WorkflowHookError.tokenNotUnique(kind, name);
  }
  tokens.add(token);
}

export class Webhook<TPayload> implements WebhookContract<TPayload> {
  readonly token: string;
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: MessageId;
  readonly metadata?: unknown;

  readonly #wait: () => Promise<unknown>;

  constructor(runId: RunId, options: CreateWebhookOptions, wait: () => Promise<unknown>) {
    const messageId = options.messageId ?? options.name;
    const metadata =
      options.metadata === undefined
        ? undefined
        : toPersistedValue(options.metadata, "workflow webhook metadata", {});
    this.token = formatHookToken({
      runId,
      name: options.name,
      messageId: messageId,
      kind: "webhook",
      ...(metadata === undefined ? {} : { metadata }),
    });
    this.runId = runId;
    this.name = options.name;
    this.messageId = messageId;
    if (options.metadata !== undefined) {
      this.metadata = options.metadata;
    }
    this.#wait = wait;
  }

  async wait(): Promise<TPayload> {
    return (await this.#wait()) as TPayload;
  }

  // oxlint-disable-next-line unicorn/no-thenable -- Workflow webhooks intentionally support await webhook.
  then<TResult1 = TPayload, TResult2 = never>(
    onfulfilled?: ((value: TPayload) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.wait().then(onfulfilled, onrejected);
  }
}

export async function resumeHook(
  token: string,
  options: ResumeHookOptions | undefined,
  service: WorkflowHookServiceOptions,
): Promise<void> {
  const hook = parseHookToken(token);
  const payload = toOptionalPersistedValue(options?.payload, "hook payload", service.limits);
  const telemetryContext = captureTelemetryContext(service.telemetry);
  await sendWorkflowMessage(
    service.store,
    hook.runId,
    {
      messageId: hook.messageId,
      payload,
      idempotencyKey: options?.idempotencyKey,
    },
    service.now,
    service.limits,
    service.emitMessageSent,
    service.telemetry,
    telemetryContext,
  );
  service.emitHookResumed(hook.runId, hook.messageId, payload, telemetryContext);
}

export async function resumeWebhook(
  token: string,
  options: ResumeHookOptions | undefined,
  service: WorkflowHookServiceOptions,
): Promise<void> {
  const webhook = parseWebhookToken(token);
  const payload = toOptionalPersistedValue(options?.payload, "webhook payload", service.limits);
  const telemetryContext = captureTelemetryContext(service.telemetry);
  await sendWorkflowMessage(
    service.store,
    webhook.runId,
    {
      messageId: webhook.messageId,
      payload,
      idempotencyKey: options?.idempotencyKey,
    },
    service.now,
    service.limits,
    service.emitMessageSent,
    service.telemetry,
    telemetryContext,
  );
  service.emitWebhookResumed(webhook.runId, webhook.messageId, payload, telemetryContext);
}

export async function disposeHook(
  token: string,
  service: WorkflowHookServiceOptions,
): Promise<HookInspection> {
  return await disposeHookToken(token, parseHookToken(token), service);
}

export async function disposeWebhook(
  token: string,
  service: WorkflowHookServiceOptions,
): Promise<HookInspection> {
  return await disposeHookToken(token, parseWebhookToken(token), service);
}

export async function getHookByToken(
  token: string,
  store: WorkflowRunReaderRepository & WorkflowEventReader,
  now: Temporal.Instant,
): Promise<HookInspection> {
  const hook = parseHookToken(token);
  return inspectHookToken(
    token,
    await store.getRun(hook.runId),
    await store.getEvents(hook.runId),
    now,
  );
}

async function disposeHookToken(
  token: string,
  hook: ParsedWorkflowHookToken,
  service: WorkflowHookServiceOptions,
): Promise<HookInspection> {
  let timestamp: Temporal.Instant | undefined;
  for (let attempt = 0; attempt < MAX_HOOK_DISPOSAL_APPEND_ATTEMPTS; attempt++) {
    const run = await service.store.getRun(hook.runId);
    const events = run === undefined ? [] : await service.store.getEvents(hook.runId);
    const inspection = inspectHookToken(token, run, events, service.now());
    if (inspection.status !== "waiting") {
      return inspection;
    }
    if (run === undefined) {
      return inspection;
    }
    if (inspection.stepId === undefined) {
      WorkflowHookError.waitingStepMissing();
    }
    timestamp ??= service.now();
    enforceWorkflowEventHistoryNextLimit(events, service.limits);
    const appendedEvents = await service.store.appendEventIfRunCurrent(run, {
      kind: "message_wait_failed",
      timestamp,
      stepId: inspection.stepId,
      stepName: hook.name,
      messageId: hook.messageId,
      error: serializeError(
        WorkflowHookDisposedError.create({
          runId: hook.runId,
          stepId: inspection.stepId,
          stepName: hook.name,
          messageId: hook.messageId,
        }),
      ),
    });
    if (appendedEvents === undefined) {
      continue;
    }
    if (run.status === "waiting") {
      await service.store.updateRunIfCurrent(run, {
        ...run,
        availableAt:
          run.availableAt !== undefined && Temporal.Instant.compare(run.availableAt, timestamp) <= 0
            ? run.availableAt
            : timestamp,
        updatedAt: timestamp,
        lastTransitionAt: timestamp,
        lastTransitionReason: "waiting",
        deadlineAt: run.deadlineAt,
        retryAt: run.retryAt,
        error: undefined,
        output: undefined,
        finishedAt: undefined,
      });
    }
    return inspectHookToken(token, run, appendedEvents, service.now());
  }
  const run = await service.store.getRun(hook.runId);
  return inspectHookToken(
    token,
    run,
    run === undefined ? [] : await service.store.getEvents(hook.runId),
    service.now(),
  );
}

export function inspectHookToken(
  token: string,
  run: WorkflowRunRecord | undefined,
  events: readonly EventRecord[],
  now: Temporal.Instant,
): HookInspection {
  const hook = parseHookToken(token);
  if (run === undefined) {
    return hookInspection(token, hook, "not-found");
  }
  const history = new WorkflowHistory(events);
  const started = history.latestMessageWaitStartedByNameAndMessageId(hook.name, hook.messageId);
  if (started === undefined) {
    return hookInspection(token, hook, "not-found");
  }
  const terminal = history.latestMessageWaitTerminalAfterStarted(started);
  if (terminal?.kind === "message_wait_completed") {
    return hookInspection(token, hook, "completed", {
      stepId: started.stepId,
      timeoutAt: started.timeoutAt,
      payload: terminal.payload,
    });
  }
  if (terminal?.kind === "message_wait_failed") {
    const status = WorkflowHookDisposedError.isDisposed(terminal.error) ? "disposed" : "failed";
    return hookInspection(token, hook, status, {
      stepId: started.stepId,
      timeoutAt: started.timeoutAt,
      error: terminal.error,
    });
  }
  if (run.status === "completed" || run.status === "failed" || run.status === "canceled") {
    return hookInspection(token, hook, "run-terminal", {
      stepId: started.stepId,
      timeoutAt: started.timeoutAt,
    });
  }
  if (started.timeoutAt !== undefined && Temporal.Instant.compare(started.timeoutAt, now) <= 0) {
    return hookInspection(token, hook, "expired", {
      stepId: started.stepId,
      timeoutAt: started.timeoutAt,
    });
  }
  return hookInspection(token, hook, "waiting", {
    stepId: started.stepId,
    timeoutAt: started.timeoutAt,
  });
}

function hookInspection(
  token: string,
  hook: ParsedWorkflowHookToken,
  status: HookInspectionStatus,
  state: WorkflowHookInspectionState = {},
): HookInspection {
  return {
    token,
    runId: hook.runId,
    name: hook.name,
    messageId: hook.messageId,
    kind: hook.kind,
    status,
    ...(hook.metadata === undefined ? {} : { metadata: hook.metadata }),
    ...(state.stepId === undefined ? {} : { stepId: state.stepId }),
    ...(state.timeoutAt === undefined ? {} : { timeoutAt: state.timeoutAt }),
    ...(state.payload === undefined ? {} : { payload: state.payload }),
    ...(state.error === undefined ? {} : { error: state.error }),
  };
}

interface WorkflowHookInspectionState {
  readonly stepId?: string;
  readonly timeoutAt?: Temporal.Instant;
  readonly payload?: unknown;
  readonly error?: WorkflowErrorRecord;
}

interface WorkflowHookTokenFormatInput {
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: string;
  readonly kind?: HookKind;
  readonly metadata?: unknown;
}

// The token carries hook metadata only; resumed payloads are persisted through messages.
function formatHookToken(hook: WorkflowHookTokenFormatInput): string {
  const payload: HookTokenPayload = { v: 1, ...hook };
  return `${WORKFLOW_HOOK_TOKEN_PREFIX}${WORKFLOW_HOOK_TOKEN_VERSION}:${encodeBase64UrlString(
    JSON.stringify(payload),
  )}`;
}
