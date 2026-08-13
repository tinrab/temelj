import "temporal-polyfill/global";
import type { StorageValue } from "@temelj/storage";

import type { WorkflowRunHandle as WorkflowRunHandleContract } from "../types/client.ts";
import type { WorkflowDefinition } from "../types/definition.ts";
import type {
  WorkflowRunMaintenance,
  WorkflowRunHandleReader,
  WorkflowStreamReader,
} from "../types/engine.ts";
import type { ExecutionResult, ResultOptions } from "../types/result.ts";
import type {
  WorkflowMarkRunPermanentlyFailedOptions,
  WorkflowReleaseStaleLeaseOptions,
  WorkflowRescheduleRunOptions,
  WorkflowRetryFailedRunOptions,
} from "../types/run-options.ts";
import type { RunId, WorkflowAttributePatch, WorkflowRunRecord } from "../types/run.ts";
import type {
  FollowStreamOptions,
  ReadStreamOptions,
  ReadStreamPageOptions,
  WaitStreamOptions,
} from "../types/stream.ts";

import {
  WorkflowResultTimeoutError,
  WorkflowRunCanceledError,
  WorkflowRunNotFoundError,
} from "../errors/mod.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import { durationBetween } from "../temporal.ts";
import { nonNegativeTimerDelay, sleep } from "../timer.ts";
import { StreamIdOrName } from "../types/stream-id.ts";
import { durationTotal } from "../utility.ts";

const DEFAULT_RESULT_POLL_INTERVAL = Temporal.Duration.from({ milliseconds: 100 });

type WorkflowRunHandleEngine = WorkflowRunHandleReader &
  WorkflowStreamReader &
  WorkflowRunMaintenance;

export function createWorkflowRunHandle<TOutput>(
  engine: WorkflowRunHandleEngine,
  definition: WorkflowDefinition<unknown, TOutput>,
  runId: RunId,
  now: () => Temporal.Instant,
): WorkflowRunHandleContract<TOutput> {
  return new WorkflowRunHandle(engine, definition, runId, now);
}

export class WorkflowRunHandle<TOutput> implements WorkflowRunHandleContract<TOutput> {
  /** @inheritdoc */
  readonly runId: RunId;
  /** @inheritdoc */
  readonly workflowName: string;
  /** @inheritdoc */
  readonly workflowVersion?: string;

  readonly #engine: WorkflowRunHandleEngine;
  readonly #now: () => Temporal.Instant;

  constructor(
    engine: WorkflowRunHandleEngine,
    definition: WorkflowDefinition<unknown, TOutput>,
    runId: RunId,
    now: () => Temporal.Instant,
  ) {
    this.#engine = engine;
    this.#now = now;
    this.runId = runId;
    this.workflowName = definition.name;
    if (definition.version !== undefined) {
      this.workflowVersion = definition.version;
    }
  }

  /** @inheritdoc */
  async getRun() {
    const run = await this.#engine.getRun(this.runId);
    if (run === undefined) {
      WorkflowRunNotFoundError.notFound(this.runId);
    }
    return run;
  }

  /** @inheritdoc */
  async status() {
    const run = await this.#engine.getRun(this.runId);
    if (run === undefined) {
      WorkflowRunNotFoundError.notFound(this.runId);
    }
    return run.status;
  }

  /** @inheritdoc */
  async events() {
    return await this.#engine.getEvents(this.runId);
  }

  /** @inheritdoc */
  async timeline() {
    return await this.#engine.getTimeline(this.runId);
  }

  /** @inheritdoc */
  async result(options?: ResultOptions): Promise<TOutput> {
    const pollInterval = nonNegativeTimerDelay(
      options?.pollInterval ?? DEFAULT_RESULT_POLL_INTERVAL,
      "Workflow result pollInterval",
    ).clampedDelay;
    const timeout = options?.timeout;
    const deadlineAt = timeout === undefined ? undefined : this.#now().add(timeout);

    while (true) {
      const run = await this.#engine.getRun(this.runId);
      if (run === undefined) {
        WorkflowRunNotFoundError.notFound(this.runId);
      }
      if (run.status === "canceled") {
        WorkflowRunCanceledError.canceled(this.runId);
      }
      const result = runToResult<TOutput>(run, this.runId, this.#now());
      if (result.kind === "completed") {
        return result.output;
      }
      if (result.kind === "failed") {
        throw workflowErrorFromRecord(result.error);
      }

      let sleepDelay = pollInterval;
      if (timeout !== undefined && deadlineAt !== undefined) {
        const nowInstant = this.#now();
        const remainingDelay = durationTotal(durationBetween(nowInstant, deadlineAt));
        if (remainingDelay <= 0) {
          WorkflowResultTimeoutError.timedOut(this.runId, timeout);
        }
        sleepDelay = Math.min(sleepDelay, remainingDelay);
      }

      await sleep(sleepDelay);
    }
  }

  /** @inheritdoc */
  async getStreamInfo(streamIdOrName: StreamIdOrName) {
    return await this.#engine.getStreamInfo(this.runId, streamIdOrName);
  }

  /** @inheritdoc */
  followStream<TChunk = unknown>(
    streamIdOrName: StreamIdOrName,
    followOptions?: FollowStreamOptions,
  ) {
    return this.#engine.followStream<TChunk>(this.runId, streamIdOrName, followOptions);
  }

  /** @inheritdoc */
  async waitForStream(streamIdOrName: StreamIdOrName, waitOptions?: WaitStreamOptions) {
    return await this.#engine.waitForStream(this.runId, streamIdOrName, waitOptions);
  }

  /** @inheritdoc */
  async waitForStreamChunk<TChunk = unknown>(
    streamIdOrName: StreamIdOrName,
    afterIndex: number,
    waitOptions?: WaitStreamOptions,
  ) {
    return await this.#engine.waitForStreamChunk<TChunk>(
      this.runId,
      streamIdOrName,
      afterIndex,
      waitOptions,
    );
  }

  /** @inheritdoc */
  async waitForStreamTerminal(streamIdOrName: StreamIdOrName, waitOptions?: WaitStreamOptions) {
    return await this.#engine.waitForStreamTerminal(this.runId, streamIdOrName, waitOptions);
  }

  /** @inheritdoc */
  async readStream<TChunk = unknown>(
    streamIdOrName: StreamIdOrName,
    readOptions?: ReadStreamOptions,
  ) {
    return await this.#engine.readStream<TChunk>(this.runId, streamIdOrName, readOptions);
  }

  /** @inheritdoc */
  async readStreamPage<TChunk = unknown>(
    streamIdOrName: StreamIdOrName,
    readOptions?: ReadStreamPageOptions,
  ) {
    return await this.#engine.readStreamPage<TChunk>(this.runId, streamIdOrName, readOptions);
  }

  /** @inheritdoc */
  async reschedule(options?: WorkflowRescheduleRunOptions) {
    return await this.#engine.rescheduleRun(this.runId, options);
  }

  /** @inheritdoc */
  async releaseStaleLease(options?: WorkflowReleaseStaleLeaseOptions) {
    return await this.#engine.releaseStaleRunLease(this.runId, options);
  }

  /** @inheritdoc */
  async retryFailed(options?: WorkflowRetryFailedRunOptions) {
    return await this.#engine.retryFailedRun(this.runId, options);
  }

  /** @inheritdoc */
  async markPermanentlyFailed(options: WorkflowMarkRunPermanentlyFailedOptions) {
    return await this.#engine.markRunPermanentlyFailed(this.runId, options);
  }

  /** @inheritdoc */
  async setMetadata(metadata: unknown) {
    return await this.#engine.updateRunMetadata(this.runId, metadata);
  }

  /** @inheritdoc */
  async setAttributes(attributes: WorkflowAttributePatch) {
    return await this.#engine.setRunAttributes(this.runId, attributes);
  }

  /** @inheritdoc */
  async cancel() {
    return await this.#engine.cancelRun(this.runId);
  }
}

function runToResult<TOutput>(
  run: WorkflowRunRecord | undefined,
  runId: RunId,
  fallbackAvailableAt: Temporal.Instant,
): ExecutionResult<TOutput> {
  if (run === undefined) {
    WorkflowRunNotFoundError.notFound(runId);
  }
  if (run.status === "completed") {
    const output = run.output as TOutput;
    return {
      kind: "completed",
      run: run as WorkflowRunRecord<StorageValue, TOutput>,
      output,
    };
  }
  if (run.status === "failed") {
    return {
      kind: "failed",
      run,
      error: run.error ?? {
        name: "WorkflowError",
        message: `Workflow run failed: ${run.id}`,
      },
    };
  }
  if (run.status === "canceled") {
    return {
      kind: "failed",
      run,
      error: run.error ?? {
        name: "WorkflowRunCanceledError",
        message: `Workflow run was canceled: ${run.id}`,
      },
    };
  }
  return {
    kind: "waiting",
    run,
    availableAt: run.availableAt ?? fallbackAvailableAt,
  };
}
