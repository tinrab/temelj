import type { Schema } from "@temelj/standard-schema";
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

export function createWorkflowStepHookApi(
  environment: WorkflowExecutionEnvironment,
): WorkflowStepHookApi {
  const { runId } = environment;
  const tokens = new Set<string>();

  function create(options: CreateHookOptions): HookContract<StorageValue | undefined>;
  function create<TPayload>(
    options: CreateHookOptions<Schema<unknown, TPayload>> & {
      readonly schema: Schema<unknown, TPayload>;
    },
  ): HookContract<TPayload>;
  function create<TPayload>(
    options: CreateHookOptions<Schema<unknown, TPayload> | undefined>,
  ): HookContract<TPayload | StorageValue | undefined> {
    const hook = new Hook(runId, options, () =>
      waitForWorkflowMessage(environment, {
        commandId: options.commandId ?? options.name,
        messageId: options.messageId ?? options.name,
        source: "hook",
        timeout: options.timeout,
        schema: options.schema,
      }),
    );

    requireUniqueWorkflowStepHookToken(tokens, "hook", hook.name, hook.token);

    return hook;
  }

  function createWebhook(options: CreateWebhookOptions): WebhookContract<StorageValue | undefined>;
  function createWebhook<TPayload>(
    options: CreateWebhookOptions<Schema<unknown, TPayload>> & {
      readonly schema: Schema<unknown, TPayload>;
    },
  ): WebhookContract<TPayload>;
  function createWebhook<TPayload>(
    options: CreateWebhookOptions<Schema<unknown, TPayload> | undefined>,
  ): WebhookContract<TPayload | StorageValue | undefined> {
    const webhook = new Webhook(runId, options, () =>
      waitForWorkflowMessage(environment, {
        commandId: options.commandId ?? options.name,
        messageId: options.messageId ?? options.name,
        source: "webhook",
        timeout: options.timeout,
        schema: options.schema,
      }),
    );

    requireUniqueWorkflowStepHookToken(tokens, "webhook", webhook.name, webhook.token);

    return webhook;
  }

  return { create, createWebhook };
}

export class Hook<TPayload> implements HookContract<TPayload> {
  readonly token: string;
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: MessageId;

  readonly #wait: () => Promise<TPayload>;

  constructor(
    runId: RunId,
    options: Omit<CreateHookOptions, "schema">,
    wait: () => Promise<TPayload>,
  ) {
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
    return await this.#wait();
  }

  // oxlint-disable-next-line unicorn/no-thenable -- Workflow hooks intentionally support await hook.
  then<TResult1 = TPayload, TResult2 = never>(
    onfulfilled?: ((value: TPayload) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((cause: unknown) => TResult2 | PromiseLike<TResult2>) | null,
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
  readonly metadata?: StorageValue;

  readonly #wait: () => Promise<TPayload>;

  constructor(
    runId: RunId,
    options: Omit<CreateWebhookOptions, "schema">,
    wait: () => Promise<TPayload>,
  ) {
    const messageId = options.messageId ?? options.name;

    const metadata =
      options.metadata === undefined
        ? undefined
        : toPersistedValue(options.metadata, "workflow webhook metadata", {});

    const token: HookTokenPayload = {
      runId,
      name: options.name,
      messageId: messageId,
      kind: "webhook",
    };

    if (metadata !== undefined) {
      Object.assign(token, { metadata } satisfies Partial<HookTokenPayload>);
    }

    this.token = formatHookToken(token);
    this.runId = runId;
    this.name = options.name;
    this.messageId = messageId;

    if (options.metadata !== undefined) {
      this.metadata = options.metadata;
    }

    this.#wait = wait;
  }

  async wait(): Promise<TPayload> {
    return await this.#wait();
  }

  // oxlint-disable-next-line unicorn/no-thenable -- Workflow webhooks intentionally support await webhook.
  then<TResult1 = TPayload, TResult2 = never>(
    onfulfilled?: ((value: TPayload) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((cause: unknown) => TResult2 | PromiseLike<TResult2>) | null,
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
  const summary: HookInspection = {
    token,
    runId: hook.runId,
    name: hook.name,
    messageId: hook.messageId,
    kind: hook.kind,
    status,
  };

  if (hook.metadata !== undefined) {
    Object.assign(summary, { metadata: hook.metadata } satisfies Partial<HookInspection>);
  }

  if (state.stepId !== undefined) {
    Object.assign(summary, { stepId: state.stepId } satisfies Partial<HookInspection>);
  }

  if (state.timeoutAt !== undefined) {
    Object.assign(summary, { timeoutAt: state.timeoutAt } satisfies Partial<HookInspection>);
  }

  if (state.payload !== undefined) {
    Object.assign(summary, { payload: state.payload } satisfies Partial<HookInspection>);
  }

  if (state.error !== undefined) {
    Object.assign(summary, { error: state.error } satisfies Partial<HookInspection>);
  }

  return summary;
}

interface WorkflowHookInspectionState {
  readonly stepId?: string;
  readonly timeoutAt?: Temporal.Instant;
  readonly payload?: StorageValue;
  readonly error?: WorkflowErrorRecord;
}

interface WorkflowHookTokenFormatInput {
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: string;
  readonly kind?: HookKind;
  readonly metadata?: StorageValue;
}

// The token carries hook metadata only; resumed payloads are persisted through messages.
function formatHookToken(hook: WorkflowHookTokenFormatInput): string {
  const payload: HookTokenPayload = { v: 1, ...hook };

  return `${WORKFLOW_HOOK_TOKEN_PREFIX}${WORKFLOW_HOOK_TOKEN_VERSION}:${encodeBase64UrlString(
    JSON.stringify(payload),
  )}`;
}
