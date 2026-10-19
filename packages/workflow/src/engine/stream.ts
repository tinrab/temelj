// This module uses Temporal while loading, so the polyfill must be installed first.
import "temporal-polyfill/global";
import type { StorageValue } from "@temelj/storage";

import { deepEquals } from "@temelj/value";

import type { ExecutionEnvironment } from "../types/engine.ts";
import type { StreamStartedEvent } from "../types/events.ts";
import type { RunId, StepId, StreamId, StreamIdOrName } from "../types/ids.ts";
import type { StepIdentity } from "../types/run.ts";
import type { StepStreamApi } from "../types/step.ts";
import type {
  CreateStreamOptions,
  ReadStreamOptions,
  StreamInfo,
  Stream as StreamContract,
  StreamChunk,
  StreamState,
} from "../types/stream.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import {
  WorkflowReplayDivergenceError,
  WorkflowStreamError,
  WorkflowStreamNotFoundError,
} from "../errors/mod.ts";
import { History, type StreamEventProjection } from "../history/replay.ts";
import { resolveCommandIdentity } from "./command-identity.ts";
import { appendDurableStepStartedEvent, appendDurableEvent } from "./durable-command.ts";
import { serializeError, toOptionalPersistedValue, toPersistedValue } from "./serialization.ts";

const DEFAULT_MAXIMUM_STREAM_CHUNKS = 1_000;

export function createStepStreamApi(environment: ExecutionEnvironment): StepStreamApi {
  const { history } = environment;

  return {
    create<TChunk = unknown>(commandId: string, options: CreateStreamOptions = {}): Stream<TChunk> {
      const identity = resolveCommandIdentity(history, "stream", commandId);

      return new Stream<TChunk>(environment, identity, commandId, options);
    },
  };
}

interface StreamEventFields {
  readonly timestamp: Temporal.Instant;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly streamId: StreamId;
}

class Stream<TChunk> implements StreamContract<TChunk> {
  readonly id: string;
  readonly name: string;
  readonly contentType?: string;
  readonly metadata?: StorageValue;

  readonly #environment: ExecutionEnvironment;
  readonly #identity: StepIdentity<"stream">;
  readonly #maximumChunks: number;
  readonly #persistedMetadata?: StorageValue;
  #nextChunkIndex = 0;

  constructor(
    environment: ExecutionEnvironment,
    identity: StepIdentity<"stream">,
    name: string,
    options: CreateStreamOptions = {},
  ) {
    const streamId = options.id ?? name;

    const maximumChunks =
      options.maximumChunks !== undefined
        ? options.maximumChunks
        : (environment.limits.maximumStreamChunks ?? DEFAULT_MAXIMUM_STREAM_CHUNKS);

    const persistedMetadata = toOptionalPersistedValue(
      options.metadata,
      `workflow stream ${streamId} metadata`,
      environment.limits,
    );

    const started = environment.history.startedStream(identity.id);

    if (started !== undefined) {
      requireStreamReplayMatches(identity, started, {
        streamId,
        contentType: options.contentType,
        metadata: persistedMetadata,
      });
    }

    this.#environment = environment;
    this.#identity = identity;
    this.id = streamId;
    this.name = name;

    if (options.contentType !== undefined) {
      this.contentType = options.contentType;
    }

    if (options.metadata !== undefined) {
      this.metadata = options.metadata;
    }

    this.#maximumChunks = maximumChunks;
    this.#persistedMetadata = persistedMetadata;
  }

  async #start(): Promise<void> {
    await ensureStreamStarted(
      this.#environment,
      this.#identity,
      this.id,
      this.contentType,
      this.#persistedMetadata,
    );
  }

  /** Fields every event of this stream carries. */
  #eventFields(): StreamEventFields {
    return {
      timestamp: this.#environment.now(),
      stepId: this.#identity.id,
      stepName: this.#identity.name,
      streamId: this.id,
    };
  }

  async write(chunk: TChunk) {
    await this.#start();

    const persistedChunk = toPersistedValue(
      chunk,
      `workflow stream ${this.id} chunk`,
      this.#environment.limits,
    );

    const existing = this.#environment.history.streamChunk(this.#identity.id, this.#nextChunkIndex);
    const index = this.#nextChunkIndex;
    this.#nextChunkIndex++;

    if (existing !== undefined) {
      requireStreamChunkReplayMatches(
        this.#identity,
        existing.index,
        existing.chunk,
        persistedChunk,
      );

      return;
    }

    requireStreamOpen(this.#environment, this.#identity.id, this.id);

    if (index >= this.#maximumChunks) {
      throw new WorkflowStreamError(
        `Workflow stream ${this.id} chunk count would exceed maximumStreamChunks ${this.#maximumChunks}`,
        WorkflowErrorCode.STREAM_CHUNK_LIMIT_EXCEEDED,
        { streamId: this.id, maximumChunks: this.#maximumChunks },
      );
    }

    await appendDurableEvent(this.#environment, {
      kind: "stream_chunk",
      ...this.#eventFields(),
      index,
      chunk: persistedChunk,
    });
  }

  async close() {
    await this.#start();
    const closed = this.#environment.history.closedStream(this.#identity.id);

    if (closed !== undefined) {
      return;
    }

    requireStreamOpen(this.#environment, this.#identity.id, this.id);
    await appendDurableEvent(this.#environment, {
      kind: "stream_closed",
      ...this.#eventFields(),
    });
  }

  async error(cause: unknown) {
    await this.#start();
    const failed = this.#environment.history.failedStream(this.#identity.id);

    if (failed !== undefined) {
      return;
    }

    requireStreamOpen(this.#environment, this.#identity.id, this.id);
    await appendDurableEvent(this.#environment, {
      kind: "stream_failed",
      ...this.#eventFields(),
      error: serializeError(cause),
    });
  }
}

export function readStreamFromHistory(
  runId: RunId,
  history: History,
  streamIdOrName: StreamIdOrName,
  options: ReadStreamOptions = {},
): StreamState {
  if (options.fromIndex !== undefined && options.fromTail !== undefined) {
    WorkflowStreamError.readOffsetConflict();
  }

  const projection = requireStreamProjectionFromHistory(history, streamIdOrName);
  const info = getStreamInfoFromProjection(runId, projection);

  const fromIndex =
    options.fromTail === undefined
      ? (options.fromIndex ?? 0)
      : Math.max(0, info.chunkCount - options.fromTail);

  const chunks = projection.chunks
    .filter((chunk) => chunk.event.index >= fromIndex)
    .map((chunk): StreamChunk => ({
      index: chunk.event.index,
      timestamp: chunk.event.timestamp,
      value: chunk.event.chunk,
    }))
    .sort((left, right) => left.index - right.index)
    .slice(0, options.maxChunks);

  return {
    ...info,
    chunks,
  };
}

export function getStreamInfoFromHistory(
  runId: RunId,
  history: History,
  streamIdOrName: StreamIdOrName,
): StreamInfo {
  return getStreamInfoFromProjection(
    runId,
    requireStreamProjectionFromHistory(history, streamIdOrName),
  );
}

function requireStreamProjectionFromHistory(
  history: History,
  streamIdOrName: StreamIdOrName,
): StreamEventProjection {
  const projection = history.streamProjection(streamIdOrName);

  if (projection === undefined) {
    throw new WorkflowStreamNotFoundError(streamIdOrName);
  }

  return projection;
}

function getStreamInfoFromProjection(runId: RunId, projection: StreamEventProjection): StreamInfo {
  const { started, chunks, closed, failed } = projection;
  requireStreamEventOrder(projection);
  const latestChunk = chunks.at(-1)?.event;

  return {
    runId,
    id: started.streamId,
    name: started.stepName,
    status: failed === undefined ? (closed === undefined ? "open" : "closed") : "failed",
    createdAt: started.timestamp,
    updatedAt:
      failed?.event.timestamp ??
      closed?.event.timestamp ??
      latestChunk?.timestamp ??
      started.timestamp,
    contentType: started.contentType,
    metadata: started.metadata,
    chunkCount: chunks.length,
    lastIndex: latestChunk?.index,
    error: failed?.event.error,
  };
}

function requireStreamEventOrder(projection: StreamEventProjection): void {
  const { started, chunks, closed, failed } = projection;

  for (const [index, chunk] of chunks.entries()) {
    if (chunk.event.index !== index) {
      throw new WorkflowStreamError(
        `Workflow stream ${started.streamId} has non-contiguous chunk index ${chunk.event.index}; expected ${index}`,
        WorkflowErrorCode.STREAM_CHUNK_INDEX_NON_CONTIGUOUS,
        { streamId: started.streamId, actualIndex: chunk.event.index, expectedIndex: index },
      );
    }
  }

  const terminal = earliestStreamTerminalEvent(closed, failed);

  if (terminal === undefined) {
    return;
  }

  const lateChunk = chunks.find((chunk) => chunk.index > terminal.index);

  if (lateChunk !== undefined) {
    throw new WorkflowStreamError(
      `Workflow stream ${started.streamId} has chunk ${lateChunk.event.index} after terminal event ${terminal.event.kind}`,
      WorkflowErrorCode.STREAM_CHUNK_AFTER_TERMINAL,
      {
        streamId: started.streamId,
        chunkIndex: lateChunk.event.index,
        terminalKind: terminal.event.kind,
      },
    );
  }
}

function earliestStreamTerminalEvent(
  closed: StreamEventProjection["closed"],
  failed: StreamEventProjection["failed"],
): StreamEventProjection["closed"] | StreamEventProjection["failed"] {
  if (closed === undefined) {
    return failed;
  }

  if (failed === undefined) {
    return closed;
  }

  return closed.index <= failed.index ? closed : failed;
}

async function ensureStreamStarted(
  environment: ExecutionEnvironment,
  identity: StepIdentity<"stream">,
  streamId: StreamId,
  contentType: string | undefined,
  metadata: StorageValue | undefined,
): Promise<void> {
  if (environment.history.startedStream(identity.id) !== undefined) {
    return;
  }

  const event: StreamStartedEvent = {
    kind: "stream_started",
    timestamp: environment.now(),
    stepId: identity.id,
    stepName: identity.name,
    count: identity.count,
    streamId,
    contentType,
    metadata,
  };

  await appendDurableStepStartedEvent(environment, event);
}

function requireStreamOpen(
  environment: ExecutionEnvironment,
  stepId: StepId,
  streamId: StreamId,
): void {
  if (
    environment.history.closedStream(stepId) !== undefined ||
    environment.history.failedStream(stepId) !== undefined
  ) {
    throw new WorkflowStreamError(
      `Workflow stream is already closed: ${streamId}`,
      WorkflowErrorCode.STREAM_ALREADY_CLOSED,
      { streamId: streamId },
    );
  }
}

function requireStreamReplayMatches(
  identity: StepIdentity<"stream">,
  recorded: StreamStartedEvent,
  next: {
    readonly streamId: StreamId;
    readonly contentType?: string;
    readonly metadata?: StorageValue;
  },
): void {
  if (
    recorded.stepId === identity.id &&
    recorded.stepName === identity.name &&
    recorded.streamId === next.streamId &&
    recorded.contentType === next.contentType &&
    deepEquals(recorded.metadata, next.metadata)
  ) {
    return;
  }

  WorkflowReplayDivergenceError.diverged(
    `recorded stream ${recorded.stepId} does not match replayed stream ${identity.id}`,
    {
      expectedStepId: recorded.stepId,
      actualStepId: identity.id,
    },
  );
}

function requireStreamChunkReplayMatches(
  identity: StepIdentity<"stream">,
  index: number,
  recorded: StorageValue | undefined,
  next: StorageValue,
): void {
  if (deepEquals(recorded, next)) {
    return;
  }

  WorkflowReplayDivergenceError.atStep(
    identity.id,
    `recorded stream ${identity.id} chunk ${index} does not match replayed chunk`,
  );
}
