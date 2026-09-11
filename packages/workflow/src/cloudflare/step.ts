import { createNoopLogger, type Logger } from "@temelj/log";
import { validateStandardSchema } from "@temelj/standard-schema";

import type { WorkflowRunContext } from "../types/definition.ts";
import type { WorkflowContext } from "../types/definition.ts";
import type { WorkflowResolvedStepRetryConfig } from "../types/retry.ts";
import type {
  WorkflowStepApi,
  WorkflowStepContext,
  WorkflowStepDefinition,
  WorkflowStepRunConfig,
} from "../types/step.ts";
import type {
  CloudflareNonRetryableErrorConstructor,
  CloudflareWorkflowStep,
  CloudflareWorkflowStepConfig,
  CloudflareWorkflowStepContext,
} from "./types.ts";

import { resolveWorkflowRetryConfig } from "../engine/retry.ts";
import { WorkflowCapabilityError, WorkflowNonRetryableError } from "../errors/mod.ts";
import { createWorkflowMessageWait } from "../message-options.ts";
import { durationTotal } from "../temporal.ts";
import { decodeCloudflareWorkflowValue, encodeCloudflareWorkflowValue } from "./codec.ts";
import { makeCloudflareWorkflowEventType, makeCloudflareWorkflowStepName } from "./name.ts";

const DEFAULT_STEP_RETRY = {
  maximumAttempts: 10,
  backoffCoefficient: 2,
} as const;

const MAXIMUM_CLOUDFLARE_ATTEMPTS = 10_000;

const MAXIMUM_CLOUDFLARE_DELAY_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

const MAXIMUM_CLOUDFLARE_STEP_TIMEOUT_MILLISECONDS = 30 * 60 * 1_000;

const MAXIMUM_EVENT_WAIT_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

export interface CreateCloudflareWorkflowStepApiOptions {
  readonly step: CloudflareWorkflowStep;
  readonly logger?: Logger;
  readonly nonRetryableError?: CloudflareNonRetryableErrorConstructor;
}

/** Creates the Temelj durable command API backed by one Cloudflare Workflow step object. */
export function createCloudflareWorkflowStepApi(
  options: CreateCloudflareWorkflowStepApiOptions,
): WorkflowStepApi {
  const logger = options.logger ?? createNoopLogger();

  const runTask = async <TOutput>(
    config: WorkflowStepRunConfig,
    callback: (context: WorkflowStepContext) => TOutput | Promise<TOutput>,
  ): Promise<TOutput> => {
    const commandName = config.commandId ?? config.name;

    if (commandName === undefined) {
      throw new TypeError("Cloudflare durable task requires a name or commandId");
    }

    const retry = resolveWorkflowRetryConfig(
      config.retry,
      DEFAULT_STEP_RETRY,
      "Cloudflare Workflow step retry",
    );

    const stepName = makeCloudflareWorkflowStepName(commandName);

    const encoded = await options.step.do(
      stepName,
      cloudflareStepConfig(config, retry),
      async (cloudflareContext) => {
        const context = workflowStepContext(commandName, retry, cloudflareContext, logger);

        try {
          return encodeCloudflareWorkflowValue(await callback(context));
        } catch (error) {
          if (
            error instanceof WorkflowNonRetryableError &&
            options.nonRetryableError !== undefined
          ) {
            throw new options.nonRetryableError(error.message, error.name);
          }

          throw error;
        }
      },
    );

    // SAFETY: do stores this command's encoded callback result; the codec validates and restores its supported value types on execution and replay.
    return decodeCloudflareWorkflowValue(
      encoded,
      `Cloudflare step ${commandName} result`,
    ) as TOutput;
  };

  const deterministic = {
    now: async (commandId = "now") =>
      await runTask({ commandId: `deterministic:${commandId}` }, () => Temporal.Now.instant()),
    random: async (commandId = "random") =>
      await runTask({ commandId: `deterministic:${commandId}` }, () => Math.random()),
    recordedId: async (commandId = "id") =>
      await runTask({ commandId: `deterministic:${commandId}` }, () => crypto.randomUUID()),
    id: async (commandId = "id") =>
      await runTask({ commandId: `deterministic:${commandId}` }, () => crypto.randomUUID()),
    uuid: async (commandId = "uuid") =>
      await runTask({ commandId: `deterministic:${commandId}` }, () => crypto.randomUUID()),
    bytes: async (commandId: string, length: number) =>
      await runTask({ commandId: `deterministic:${commandId}` }, () => {
        const bytes = new Uint8Array(length);

        for (let offset = 0; offset < bytes.byteLength; offset += 65_536) {
          crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
        }

        return bytes;
      }),
  };

  const waitMessage = createWorkflowMessageWait(async (wait) => {
    const timeout =
      wait.timeout === undefined
        ? MAXIMUM_EVENT_WAIT_MILLISECONDS
        : durationMilliseconds(wait.timeout, "Cloudflare Workflow message timeout");

    if (timeout < 1_000 || timeout > MAXIMUM_EVENT_WAIT_MILLISECONDS) {
      throw new RangeError(
        "Cloudflare Workflow message timeout must be between 1 second and 365 days",
      );
    }

    const event = await options.step.waitForEvent(
      makeCloudflareWorkflowStepName(wait.commandId ?? wait.name ?? wait.messageId),
      {
        type: makeCloudflareWorkflowEventType(wait.messageId),
        timeout,
      },
    );

    const decoded = decodeCloudflareWorkflowValue(
      event.payload,
      `Cloudflare message ${wait.messageId} payload`,
    );

    if (wait.schema === undefined) {
      return decoded;
    }

    return await validateStandardSchema(wait.schema, decoded, "Workflow message validation failed");
  });

  return {
    log: logger,
    task: {
      run: runTask,
      async call<const TArgs extends readonly unknown[], TOutput>(
        definition: WorkflowStepDefinition<TArgs, TOutput>,
        ...args: TArgs
      ): Promise<TOutput> {
        return await runTask(definition.config, async (context) => {
          return await definition.handler(context, ...args);
        });
      },
      async sleep(commandId, duration): Promise<void> {
        await options.step.sleep(
          makeCloudflareWorkflowStepName(commandId),
          durationMilliseconds(duration, "Cloudflare Workflow sleep"),
        );
      },
      async sleepUntil(commandId, timestamp): Promise<void> {
        await options.step.sleepUntil(
          makeCloudflareWorkflowStepName(commandId),
          timestamp.epochMilliseconds,
        );
      },
    },
    workflow: {
      run: unsupportedWorkflow,
      start: unsupportedWorkflow,
    },
    message: {
      send: async () => WorkflowCapabilityError.unsupported("Cloudflare in-workflow message send"),
      wait: waitMessage,
    },
    lock: {
      acquire: unsupportedLock,
      release: unsupportedLock,
      with: unsupportedLock,
    },
    runData: {
      setMetadata: unsupportedRunData,
      setAttributes: unsupportedRunData,
    },
    deterministic,
    stream: {
      create: unsupportedStream,
    },
    hook: {
      create: unsupportedHook,
      createWebhook: unsupportedHook,
    },
  };
}

export interface CreateCloudflareWorkflowContextOptions<
  TInput,
> extends CreateCloudflareWorkflowStepApiOptions {
  readonly input: TInput;
  readonly runId: string;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly createdAt: Temporal.Instant;
}

export function createCloudflareWorkflowContext<TInput>(
  options: CreateCloudflareWorkflowContextOptions<TInput>,
): WorkflowContext<TInput> {
  const logger = options.logger ?? createNoopLogger();
  const step = createCloudflareWorkflowStepApi({ ...options, logger });

  const result = {
    id: options.runId,
    workflowName: options.workflowName,
  } satisfies Partial<WorkflowRunContext>;

  if (options.workflowVersion !== undefined) {
    Object.assign(result, {
      workflowVersion: options.workflowVersion,
    } satisfies Partial<WorkflowRunContext>);
  }

  const result1 = Object.assign(result, {
    createdAt: options.createdAt,
  } satisfies Partial<WorkflowRunContext>);

  const run: WorkflowRunContext = result1;

  return {
    input: options.input,
    step,
    deterministic: step.deterministic,
    log: logger,
    run,
    signal: new AbortController().signal,
    version: options.workflowVersion,
  };
}

function cloudflareStepConfig(
  config: WorkflowStepRunConfig,
  retry: WorkflowResolvedStepRetryConfig,
): CloudflareWorkflowStepConfig {
  if (retry.maximumAttempts === 0 || retry.maximumAttempts > MAXIMUM_CLOUDFLARE_ATTEMPTS) {
    throw new RangeError(
      `Cloudflare Workflow steps support at most ${MAXIMUM_CLOUDFLARE_ATTEMPTS} attempts`,
    );
  }

  const initialDelay =
    retry.initialInterval === undefined
      ? 0
      : durationMilliseconds(retry.initialInterval, "Cloudflare Workflow retry interval");

  const maximumDelay =
    retry.maximumInterval === undefined
      ? undefined
      : durationMilliseconds(retry.maximumInterval, "Cloudflare Workflow maximum retry interval");

  assertMaximumDuration(
    initialDelay,
    MAXIMUM_CLOUDFLARE_DELAY_MILLISECONDS,
    "Cloudflare Workflow retry interval",
  );

  if (maximumDelay !== undefined) {
    assertMaximumDuration(
      maximumDelay,
      MAXIMUM_CLOUDFLARE_DELAY_MILLISECONDS,
      "Cloudflare Workflow maximum retry interval",
    );
  }

  const timeout =
    config.timeout === undefined
      ? undefined
      : durationMilliseconds(config.timeout, "Cloudflare Workflow step timeout");

  if (timeout !== undefined) {
    assertMaximumDuration(
      timeout,
      MAXIMUM_CLOUDFLARE_STEP_TIMEOUT_MILLISECONDS,
      "Cloudflare Workflow step timeout",
    );
  }

  const summary: CloudflareWorkflowStepConfig = {
    retries: {
      limit: retry.maximumAttempts,
      delay: ({ ctx }) => retryDelay(initialDelay, retry, ctx.attempt, maximumDelay),
    },
  };

  if (timeout !== undefined) {
    Object.assign(summary, { timeout } satisfies Partial<CloudflareWorkflowStepConfig>);
  }

  return summary;
}

function retryDelay(
  initialDelay: number,
  retry: WorkflowResolvedStepRetryConfig,
  attempt: number,
  maximumDelay: number | undefined,
): number {
  const delay = initialDelay * retry.backoffCoefficient ** Math.max(0, attempt - 1);

  return Math.min(delay, maximumDelay ?? MAXIMUM_CLOUDFLARE_DELAY_MILLISECONDS);
}

function workflowStepContext(
  commandName: string,
  retry: WorkflowResolvedStepRetryConfig,
  context: CloudflareWorkflowStepContext,
  logger: Logger,
): WorkflowStepContext {
  return {
    step: {
      id: `${commandName}:${context.step.count}`,
      name: commandName,
      count: context.step.count,
      kind: "run",
    },
    attempt: context.attempt,
    config: retry,
    signal: new AbortController().signal,
    log: logger,
  };
}

function durationMilliseconds(duration: Temporal.Duration, label: string): number {
  const milliseconds = durationTotal(duration);

  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new RangeError(`${label} must resolve to non-negative whole milliseconds`);
  }

  return milliseconds;
}

function assertMaximumDuration(value: number, maximum: number, label: string): void {
  if (value > maximum) {
    throw new RangeError(`${label} must not exceed ${maximum} milliseconds`);
  }
}

function unsupportedWorkflow(): never {
  return WorkflowCapabilityError.unsupported("child workflows");
}

function unsupportedLock(): never {
  return WorkflowCapabilityError.unsupported("Cloudflare workflow locks");
}

function unsupportedRunData(): never {
  return WorkflowCapabilityError.unsupported("Cloudflare workflow run data");
}

function unsupportedStream(): never {
  return WorkflowCapabilityError.unsupported("Cloudflare workflow streams");
}

function unsupportedHook(): never {
  return WorkflowCapabilityError.unsupported("Cloudflare workflow hooks");
}
