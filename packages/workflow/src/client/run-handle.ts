import type { StorageValue } from "@temelj/storage";

import "temporal-polyfill/global";

import type { WorkflowRunHandle as WorkflowRunHandleContract } from "../types/client.ts";
import type {
  WorkflowRunMaintenance,
  WorkflowRunHandleReader,
  WorkflowStreamReader,
} from "../types/engine.ts";
import type { WorkflowHandle, ResultOptions } from "../types/result.ts";
import type {
  WorkflowMarkRunPermanentlyFailedOptions,
  WorkflowReleaseStaleLeaseOptions,
  WorkflowRescheduleRunOptions,
  WorkflowRetryFailedRunOptions,
} from "../types/run-options.ts";
import type { RunId, WorkflowAttributePatch } from "../types/run.ts";
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
import { durationTotal } from "../temporal.ts";
import { durationBetween } from "../temporal.ts";
import { nonNegativeTimerDelay, sleep } from "../timer.ts";
import { StreamIdOrName } from "../types/stream-id.ts";

const DEFAULT_RESULT_POLL_INTERVAL = Temporal.Duration.from({ milliseconds: 100 });

type WorkflowRunHandleEngine = WorkflowRunHandleReader &
  WorkflowStreamReader &
  WorkflowRunMaintenance;

export function createWorkflowRunHandle<TOutput>(
  engine: WorkflowRunHandleEngine,
  handle: WorkflowHandle<TOutput>,
  now: () => Temporal.Instant,
): WorkflowRunHandleContract<TOutput> {
  return new WorkflowRunHandle(engine, handle, now);
}

export class WorkflowRunHandle<TOutput> implements WorkflowRunHandleContract<TOutput> {
  /** @inheritdoc */
  readonly runId: RunId;
  /** @inheritdoc */
  readonly workflowName: string;
  /** @inheritdoc */
  readonly workflowVersion?: string;

  readonly #engine: WorkflowRunHandleEngine;
  readonly #handle: WorkflowHandle<TOutput>;
  readonly #now: () => Temporal.Instant;

  constructor(
    engine: WorkflowRunHandleEngine,
    handle: WorkflowHandle<TOutput>,
    now: () => Temporal.Instant,
  ) {
    this.#engine = engine;
    this.#handle = handle;
    this.#now = now;
    this.runId = handle.runId;
    this.workflowName = handle.workflowName;

    if (handle.workflowVersion !== undefined) {
      this.workflowVersion = handle.workflowVersion;
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
      const result = await this.#handle.result();

      if (result.run.status === "canceled") {
        WorkflowRunCanceledError.canceled(this.runId);
      }

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
  followStream(streamIdOrName: StreamIdOrName, followOptions?: FollowStreamOptions) {
    return this.#engine.followStream(this.runId, streamIdOrName, followOptions);
  }

  /** @inheritdoc */
  async waitForStream(streamIdOrName: StreamIdOrName, waitOptions?: WaitStreamOptions) {
    return await this.#engine.waitForStream(this.runId, streamIdOrName, waitOptions);
  }

  /** @inheritdoc */
  async waitForStreamChunk(
    streamIdOrName: StreamIdOrName,
    afterIndex: number,
    waitOptions?: WaitStreamOptions,
  ) {
    return await this.#engine.waitForStreamChunk(
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
  async readStream(streamIdOrName: StreamIdOrName, readOptions?: ReadStreamOptions) {
    return await this.#engine.readStream(this.runId, streamIdOrName, readOptions);
  }

  /** @inheritdoc */
  async readStreamPage(streamIdOrName: StreamIdOrName, readOptions?: ReadStreamPageOptions) {
    return await this.#engine.readStreamPage(this.runId, streamIdOrName, readOptions);
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
  async setMetadata(metadata: StorageValue) {
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
