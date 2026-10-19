import type { Schema } from "@temelj/standard-schema";
import type { StorageValue } from "@temelj/storage";

import { encodeBase64UrlString } from "@temelj/string";

import type { ExecutionEnvironment } from "../types/engine.ts";
import type { WorkflowErrorRecord } from "../types/error.ts";
import type { EventRecord } from "../types/events.ts";
import type {
  CreateHookOptions,
  CreateWebhookOptions,
  Hook as HookContract,
  HookInspectionStatus,
  HookKind,
  HookInspection,
  HookTokenPayload,
  ResumeHookOptions,
  Webhook as WebhookContract,
} from "../types/hook.ts";
import type { RunId, MessageId } from "../types/ids.ts";
import type { RunRecord } from "../types/run.ts";
import type { StepHookApi } from "../types/step.ts";
import type { WorkflowStore } from "../types/store.ts";
import type { EngineContext } from "./context.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import {
  WorkflowHookDisposedError,
  WorkflowHookError,
  matchesWorkflowError,
} from "../errors/mod.ts";
import { History } from "../history/replay.ts";
import {
  WORKFLOW_HOOK_TOKEN_PREFIX,
  WORKFLOW_HOOK_TOKEN_VERSION,
  parseHookToken,
} from "../hook-token.ts";
import { captureTelemetryContext } from "../telemetry.ts";
import { sendWorkflowMessage, waitForMessage } from "./message.ts";
import { enforceEventHistoryNextLimit } from "./retry.ts";
import { serializeError, toOptionalPersistedValue, toPersistedValue } from "./serialization.ts";

const MAX_HOOK_DISPOSAL_APPEND_ATTEMPTS = 16;

export function createStepHookApi(environment: ExecutionEnvironment): StepHookApi {
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
      waitForMessage(environment, {
        commandId: options.commandId ?? options.name,
        messageId: options.messageId ?? options.name,
        source: "hook",
        timeout: options.timeout,
        schema: options.schema,
      }),
    );

    requireUniqueStepHookToken(tokens, "hook", hook.name, hook.token);

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
      waitForMessage(environment, {
        commandId: options.commandId ?? options.name,
        messageId: options.messageId ?? options.name,
        source: "webhook",
        timeout: options.timeout,
        schema: options.schema,
      }),
    );

    requireUniqueStepHookToken(tokens, "webhook", webhook.name, webhook.token);

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
      messageId,
      kind: "hook",
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

function requireUniqueStepHookToken(
  tokens: Set<string>,
  kind: "hook" | "webhook",
  name: string,
  token: string,
): void {
  if (tokens.has(token)) {
    throw new WorkflowHookError(
      `Workflow ${kind} token must be unique within a run: ${name}`,
      WorkflowErrorCode.HOOK_TOKEN_NOT_UNIQUE,
      { kind: kind, name: name },
    );
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
      messageId,
      kind: "webhook",
      metadata,
    };

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
  context: EngineContext,
): Promise<void> {
  const hook = parseHookToken(token);

  const payload = toOptionalPersistedValue(
    options?.payload,
    `${hook.kind} payload`,
    context.limits,
  );

  const telemetryContext = captureTelemetryContext(context.telemetry);

  await sendWorkflowMessage(
    context.store,
    hook.runId,
    {
      messageId: hook.messageId,
      payload,
      idempotencyKey: options?.idempotencyKey,
    },
    context.now,
    context.limits,
    context.observation.emitMessageSent,
    context.telemetry,
    telemetryContext,
  );

  context.observation.emitHookResumed(
    hook.kind,
    hook.runId,
    hook.messageId,
    payload,
    telemetryContext,
  );
}

export async function disposeHook(token: string, context: EngineContext): Promise<HookInspection> {
  return await disposeHookToken(token, parseHookToken(token), context);
}

export async function getHookByToken(
  token: string,
  store: WorkflowStore,
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
  hook: HookTokenPayload,
  context: EngineContext,
): Promise<HookInspection> {
  let timestamp: Temporal.Instant | undefined;

  for (let attempt = 0; attempt < MAX_HOOK_DISPOSAL_APPEND_ATTEMPTS; attempt++) {
    const run = await context.store.getRun(hook.runId);
    const events = run === undefined ? [] : await context.store.getEvents(hook.runId);
    const inspection = inspectHookToken(token, run, events, context.now());

    if (inspection.status !== "waiting") {
      return inspection;
    }

    if (run === undefined) {
      return inspection;
    }

    if (inspection.stepId === undefined) {
      throw new WorkflowHookError(
        "Workflow hook inspection is missing a waiting step id",
        WorkflowErrorCode.HOOK_WAITING_STEP_MISSING,
        undefined,
      );
    }

    timestamp ??= context.now();
    enforceEventHistoryNextLimit(events, context.limits);

    const appendedEvents = await context.store.appendEventIfRunCurrent(run, {
      kind: "message_wait_failed",
      timestamp,
      stepId: inspection.stepId,
      stepName: hook.name,
      messageId: hook.messageId,
      error: serializeError(
        new WorkflowHookDisposedError({
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
      await context.store.updateRunIfCurrent(run, {
        ...run,
        availableAt:
          run.availableAt !== undefined && Temporal.Instant.compare(run.availableAt, timestamp) <= 0
            ? run.availableAt
            : timestamp,
        updatedAt: timestamp,
        lastTransitionAt: timestamp,
        lastTransitionReason: "waiting",
        error: undefined,
        output: undefined,
        finishedAt: undefined,
      });
    }

    return inspectHookToken(token, run, appendedEvents, context.now());
  }

  const run = await context.store.getRun(hook.runId);

  return inspectHookToken(
    token,
    run,
    run === undefined ? [] : await context.store.getEvents(hook.runId),
    context.now(),
  );
}

function inspectHookToken(
  token: string,
  run: RunRecord | undefined,
  events: readonly EventRecord[],
  now: Temporal.Instant,
): HookInspection {
  const hook = parseHookToken(token);

  if (run === undefined) {
    return hookInspection(token, hook, "not-found");
  }

  const history = new History(events);
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
    const status = matchesWorkflowError(terminal.error, WorkflowErrorCode.HOOK_DISPOSED)
      ? "disposed"
      : "failed";

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
  hook: HookTokenPayload,
  status: HookInspectionStatus,
  state: HookInspectionState = {},
): HookInspection {
  return {
    token,
    runId: hook.runId,
    name: hook.name,
    messageId: hook.messageId,
    kind: hook.kind,
    status,
    metadata: hook.metadata,
    stepId: state.stepId,
    timeoutAt: state.timeoutAt,
    payload: state.payload,
    error: state.error,
  };
}

interface HookInspectionState {
  readonly stepId?: string;
  readonly timeoutAt?: Temporal.Instant;
  readonly payload?: StorageValue;
  readonly error?: WorkflowErrorRecord;
}

interface HookTokenFormatInput {
  readonly runId: RunId;
  readonly name: string;
  readonly messageId: string;
  readonly kind?: HookKind;
  readonly metadata?: StorageValue;
}

// The token carries hook metadata only; resumed payloads are persisted through messages.
function formatHookToken(hook: HookTokenFormatInput): string {
  return `${WORKFLOW_HOOK_TOKEN_PREFIX}${WORKFLOW_HOOK_TOKEN_VERSION}:${encodeBase64UrlString(
    JSON.stringify(hook),
  )}`;
}
