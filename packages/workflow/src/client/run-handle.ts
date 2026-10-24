// This module uses Temporal while loading, so the polyfill must be installed first.
import "temporal-polyfill/global";
import type { StorageValue } from "@temelj/storage";

import type { WorkflowEngine } from "../engine/create.ts";
import type { RunRef } from "../engine/start.ts";
import type {
  RunStreamsApi,
  WorkflowRunHandle as WorkflowRunHandleContract,
} from "../types/client.ts";
import type { EventRecord } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { ResultOptions } from "../types/result.ts";
import type { AttributePatch, RunRecord, RunStatus } from "../types/run.ts";
import type { Timeline } from "../types/timeline.ts";

import { getRunTimeline } from "../engine/inspection.ts";
import {
  cancelWorkflowRun,
  setRunAttributes,
  updateWorkflowRunMetadata,
} from "../engine/run-service.ts";
import { readRunResult } from "../engine/run-utils.ts";
import {
  followStream,
  getStreamInfo,
  readStream,
  waitForStream,
  waitForStreamChunk,
  waitForStreamTerminal,
} from "../engine/stream-reader.ts";
import {
  WorkflowResultTimeoutError,
  WorkflowRunCanceledError,
  WorkflowRunNotFoundError,
} from "../errors/mod.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import { durationTotal, durationBetween } from "../temporal.ts";
import { nonNegativeTimerDelay, sleep } from "../timer.ts";

const DEFAULT_RESULT_POLL_INTERVAL = Temporal.Duration.from({ milliseconds: 100 });

export function createRunHandle<TOutput>(
  engine: WorkflowEngine,
  ref: RunRef<TOutput>,
  now: () => Temporal.Instant,
): WorkflowRunHandleContract<TOutput> {
  return new WorkflowRunHandle(engine, ref, now);
}

export class WorkflowRunHandle<TOutput> implements WorkflowRunHandleContract<TOutput> {
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;

  readonly #engine: WorkflowEngine;
  readonly #ref: RunRef<TOutput>;
  readonly #now: () => Temporal.Instant;
  readonly streams: RunStreamsApi;

  constructor(engine: WorkflowEngine, ref: RunRef<TOutput>, now: () => Temporal.Instant) {
    this.#engine = engine;
    this.#ref = ref;
    this.#now = now;
    this.runId = ref.runId;
    this.workflowName = ref.definition.name;

    const context = engine.context;
    const runId = ref.runId;

    this.streams = {
      getInfo: (name) => getStreamInfo(context, runId, name),
      follow: (name, options) => followStream(context, runId, name, options),
      wait: (name, options) => waitForStream(context, runId, name, options),
      waitForChunk: (name, afterIndex, options) =>
        waitForStreamChunk(context, runId, name, afterIndex, options),
      waitForTerminal: (name, options) => waitForStreamTerminal(context, runId, name, options),
      read: (name, options) => readStream(context, runId, name, options),
    };

    if (ref.definition.version !== undefined) {
      this.workflowVersion = ref.definition.version;
    }
  }

  async getRun(): Promise<RunRecord> {
    const run = await this.#engine.store.getRun(this.runId);

    if (run === undefined) {
      WorkflowRunNotFoundError.notFound(this.runId);
    }

    return run;
  }

  async status(): Promise<RunStatus> {
    const run = await this.#engine.store.getRun(this.runId);

    if (run === undefined) {
      WorkflowRunNotFoundError.notFound(this.runId);
    }

    return run.status;
  }

  async events(): Promise<readonly EventRecord[]> {
    return await this.#engine.store.getEvents(this.runId);
  }

  async timeline(): Promise<Timeline> {
    return await getRunTimeline(this.#engine.context, this.runId);
  }

  async result(options?: ResultOptions): Promise<TOutput> {
    const pollInterval = nonNegativeTimerDelay(
      options?.pollInterval ?? DEFAULT_RESULT_POLL_INTERVAL,
      "Workflow result pollInterval",
    ).clampedDelay;

    const timeout = options?.timeout;
    const deadlineAt = timeout === undefined ? undefined : this.#now().add(timeout);

    while (true) {
      const result = await readRunResult(
        this.#engine.store,
        this.#ref.definition,
        this.runId,
        this.#now(),
      );

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

  async setMetadata(metadata: StorageValue): Promise<RunRecord> {
    return await updateWorkflowRunMetadata(
      this.#engine.context,
      this.#engine.lifecycle,
      this.runId,
      metadata,
    );
  }

  async setAttributes(attributes: AttributePatch): Promise<RunRecord> {
    return await setRunAttributes(this.#engine.context, this.runId, attributes);
  }

  async cancel(): Promise<RunRecord> {
    return await cancelWorkflowRun(this.#engine.context, this.#engine.lifecycle, this.runId);
  }
}
