import "temporal-polyfill/global";
import type { StorageValue } from "@temelj/storage";

import { deepEquals } from "@temelj/value";

import type { WorkflowExecutionEnvironment } from "../types/engine.ts";
import type { WorkflowStepStreamApi } from "../types/step.ts";
import type {
  WorkflowEventReader,
  WorkflowEventHistoryWatcher,
  WorkflowRunReaderRepository,
} from "../types/store.ts";
import type {
  CreateStreamOptions,
  FollowStreamOptions,
  ReadStreamPageOptions,
  ReadStreamOptions,
  StreamInfo,
  StreamPage,
  Stream as StreamContract,
  StreamChunk,
  StreamState,
  StreamUpdate,
  WaitStreamOptions,
} from "../types/stream.ts";

import {
  WorkflowOptionsError,
  WorkflowReplayDivergenceError,
  WorkflowStreamError,
  WorkflowStreamNotFoundError,
} from "../errors/mod.ts";
import { WorkflowHistory, type StreamEventProjection } from "../history/mod.ts";
import { pageItems, makeStreamChunkCursorKey } from "../pagination.ts";
import { nonNegativeTimerDelay } from "../timer.ts";
import { EventRecord, StreamStartedEvent } from "../types/events.ts";
import { RunId, WorkflowStepIdentity } from "../types/run.ts";
import { StepId } from "../types/step.ts";
import { StreamId, StreamIdOrName } from "../types/stream-id.ts";
import { isNonNegativeSafeInteger } from "../utility.ts";
import { resolveWorkflowCommandIdentity } from "./command-identity.ts";
import {
  appendDurableStepStartedEvent,
  appendDurableStepTerminalEvent,
} from "./durable-command.ts";
import { serializeError, toOptionalPersistedValue, toPersistedValue } from "./serialization.ts";
import { getRequiredRun } from "./state.ts";

const DEFAULT_MAXIMUM_STREAM_CHUNKS = 1_000;
const DEFAULT_STREAM_FOLLOW_POLL_INTERVAL = Temporal.Duration.from({ milliseconds: 100 });

interface WorkflowStreamReader<TChunk> {
  (options?: ReadStreamOptions): Promise<StreamState<TChunk>>;
}

interface WorkflowStreamInfoReader {
  (): Promise<StreamInfo>;
}

interface WorkflowStreamChangeWaiter {
  (options: { readonly signal?: AbortSignal }): Promise<void>;
}

interface WorkflowStreamWaitOptions {
  readonly waitForChange?: WorkflowStreamChangeWaiter;
}

type WorkflowStreamStore = WorkflowRunReaderRepository &
  WorkflowEventReader &
  WorkflowEventHistoryWatcher;

interface WorkflowStreamServiceOptions {
  readonly store: WorkflowStreamStore;
}

export async function getStreamInfoForRun(
  service: WorkflowStreamServiceOptions,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
): Promise<StreamInfo> {
  await getRequiredRun(service.store, runId);
  return getStreamInfoFromHistory(
    runId,
    new WorkflowHistory(await service.store.getEvents(runId)),
    streamIdOrName,
  );
}

export async function readStreamForRun<TChunk = unknown>(
  service: WorkflowStreamServiceOptions,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  readOptions?: ReadStreamOptions,
): Promise<StreamState<TChunk>> {
  await getRequiredRun(service.store, runId);
  return readStreamFromHistory<TChunk>(
    runId,
    new WorkflowHistory(await service.store.getEvents(runId)),
    streamIdOrName,
    readOptions,
  );
}

export async function readStreamPageForRun<TChunk = unknown>(
  service: WorkflowStreamServiceOptions,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  readOptions?: ReadStreamPageOptions,
): Promise<StreamPage<TChunk>> {
  const stream = await readStreamForRun<TChunk>(service, runId, streamIdOrName, readOptions);
  return {
    ...stream,
    chunks: pageItems(stream.chunks, readOptions, "Workflow stream page", makeStreamChunkCursorKey),
  };
}

export function followStreamForRun<TChunk = unknown>(
  service: WorkflowStreamServiceOptions,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  followOptions?: FollowStreamOptions,
): AsyncIterable<StreamUpdate<TChunk>> {
  return followStream<TChunk>(
    async (readOptions) =>
      await readStreamForRun<TChunk>(service, runId, streamIdOrName, readOptions),
    followOptions,
    {
      waitForChange: async ({ signal }) => await waitForStreamStorageChange(service, runId, signal),
    },
  );
}

export async function waitForStreamForRun(
  service: WorkflowStreamServiceOptions,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  waitOptions?: WaitStreamOptions,
): Promise<StreamInfo | undefined> {
  return await waitForStream(
    async () => await getStreamInfoForRun(service, runId, streamIdOrName),
    waitOptions,
    {
      waitForChange: async ({ signal }) => await waitForStreamStorageChange(service, runId, signal),
    },
  );
}

export async function waitForStreamChunkForRun<TChunk = unknown>(
  service: WorkflowStreamServiceOptions,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  afterIndex: number,
  waitOptions?: WaitStreamOptions,
): Promise<StreamChunk<TChunk> | undefined> {
  return await waitForStreamChunk<TChunk>(
    async (readOptions) =>
      await readStreamForRun<TChunk>(service, runId, streamIdOrName, readOptions),
    afterIndex,
    waitOptions,
    {
      waitForChange: async ({ signal }) => await waitForStreamStorageChange(service, runId, signal),
    },
  );
}

export async function waitForStreamTerminalForRun(
  service: WorkflowStreamServiceOptions,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  waitOptions?: WaitStreamOptions,
): Promise<StreamInfo | undefined> {
  return await waitForStreamTerminal(
    async () => await getStreamInfoForRun(service, runId, streamIdOrName),
    waitOptions,
    {
      waitForChange: async ({ signal }) => await waitForStreamStorageChange(service, runId, signal),
    },
  );
}

async function waitForStreamStorageChange(
  service: WorkflowStreamServiceOptions,
  runId: RunId,
  signal: AbortSignal | undefined,
): Promise<void> {
  await service.store.waitForEventHistoryChange(runId, { signal });
}

export function createWorkflowStepStreamApi(
  environment: WorkflowExecutionEnvironment,
): WorkflowStepStreamApi {
  const { history } = environment;
  return {
    create<TChunk = unknown>(commandId: string, options: CreateStreamOptions = {}): Stream<TChunk> {
      const identity = resolveWorkflowCommandIdentity(history, "stream", commandId);
      return createStream<TChunk>(environment, identity, commandId, options);
    },
  };
}

export function createStream<TChunk>(
  environment: WorkflowExecutionEnvironment,
  identity: WorkflowStepIdentity<"stream">,
  name: string,
  options: CreateStreamOptions = {},
): Stream<TChunk> {
  return new Stream(environment, identity, name, options);
}

class Stream<TChunk> implements StreamContract<TChunk> {
  readonly id: string;
  readonly name: string;
  readonly contentType?: string;
  readonly metadata?: unknown;

  readonly #environment: WorkflowExecutionEnvironment;
  readonly #identity: WorkflowStepIdentity<"stream">;
  readonly #maximumChunks: number;
  readonly #persistedMetadata?: StorageValue;
  #nextChunkIndex = 0;

  constructor(
    environment: WorkflowExecutionEnvironment,
    identity: WorkflowStepIdentity<"stream">,
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

  async write(chunk: TChunk) {
    await ensureStreamStarted(
      this.#environment,
      this.#identity,
      this.id,
      this.contentType,
      this.#persistedMetadata,
    );
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
      WorkflowStreamError.chunkLimitExceeded(this.id, this.#maximumChunks);
    }
    await appendDurableStepTerminalEvent(this.#environment, {
      kind: "stream_chunk",
      timestamp: this.#environment.now(),
      stepId: this.#identity.id,
      stepName: this.#identity.name,
      streamId: this.id,
      index,
      chunk: persistedChunk,
    });
  }

  async close() {
    await ensureStreamStarted(
      this.#environment,
      this.#identity,
      this.id,
      this.contentType,
      this.#persistedMetadata,
    );
    const closed = this.#environment.history.closedStream(this.#identity.id);
    if (closed !== undefined) {
      return;
    }
    requireStreamOpen(this.#environment, this.#identity.id, this.id);
    await appendDurableStepTerminalEvent(this.#environment, {
      kind: "stream_closed",
      timestamp: this.#environment.now(),
      stepId: this.#identity.id,
      stepName: this.#identity.name,
      streamId: this.id,
    });
  }

  async error(error: unknown) {
    await ensureStreamStarted(
      this.#environment,
      this.#identity,
      this.id,
      this.contentType,
      this.#persistedMetadata,
    );
    const failed = this.#environment.history.failedStream(this.#identity.id);
    if (failed !== undefined) {
      return;
    }
    requireStreamOpen(this.#environment, this.#identity.id, this.id);
    await appendDurableStepTerminalEvent(this.#environment, {
      kind: "stream_failed",
      timestamp: this.#environment.now(),
      stepId: this.#identity.id,
      stepName: this.#identity.name,
      streamId: this.id,
      error: serializeError(error),
    });
  }
}

export function readStream<TChunk = unknown>(
  runId: RunId,
  events: readonly EventRecord[],
  streamIdOrName: StreamIdOrName,
  options: ReadStreamOptions = {},
): StreamState<TChunk> {
  return readStreamFromHistory<TChunk>(runId, new WorkflowHistory(events), streamIdOrName, options);
}

function readStreamFromHistory<TChunk = unknown>(
  runId: RunId,
  history: WorkflowHistory,
  streamIdOrName: StreamIdOrName,
  options: ReadStreamOptions = {},
): StreamState<TChunk> {
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
    .map((chunk): StreamChunk<TChunk> => ({
      index: chunk.event.index,
      timestamp: chunk.event.timestamp,
      value: chunk.event.chunk as TChunk,
    }))
    .sort((left, right) => left.index - right.index)
    .slice(0, options.maxChunks);
  return {
    ...info,
    chunks,
  };
}

export async function* followStream<TChunk = unknown>(
  read: WorkflowStreamReader<TChunk>,
  options: FollowStreamOptions = {},
  waitOptions: WorkflowStreamWaitOptions = {},
): AsyncIterable<StreamUpdate<TChunk>> {
  if (options.fromIndex !== undefined && options.fromTail !== undefined) {
    WorkflowStreamError.readOffsetConflict();
  }
  const pollInterval = options.pollInterval ?? DEFAULT_STREAM_FOLLOW_POLL_INTERVAL;
  const maxChunks = options.pageSize ?? options.maxChunks;
  let nextIndex: number | undefined = options.fromIndex;
  let initialFromTail = options.fromTail;

  while (true) {
    if (options.signal?.aborted) {
      return;
    }
    const stream = await read({
      ...(nextIndex === undefined ? {} : { fromIndex: nextIndex }),
      ...(nextIndex === undefined && initialFromTail !== undefined
        ? { fromTail: initialFromTail }
        : {}),
      ...(maxChunks === undefined ? {} : { maxChunks }),
    });
    initialFromTail = undefined;

    for (const chunk of stream.chunks) {
      if (options.signal?.aborted) {
        return;
      }
      nextIndex = chunk.index + 1;
      yield {
        kind: "chunk",
        runId: stream.runId,
        streamId: stream.id,
        streamName: stream.name,
        chunk,
      };
    }

    if (nextIndex !== undefined && nextIndex < stream.chunkCount) {
      continue;
    }

    if (stream.status !== "open") {
      if (options.includeTerminal !== false) {
        yield {
          kind: stream.status,
          runId: stream.runId,
          streamId: stream.id,
          streamName: stream.name,
          info: {
            runId: stream.runId,
            id: stream.id,
            name: stream.name,
            status: stream.status,
            createdAt: stream.createdAt,
            updatedAt: stream.updatedAt,
            ...(stream.contentType === undefined ? {} : { contentType: stream.contentType }),
            ...(stream.metadata === undefined ? {} : { metadata: stream.metadata }),
            chunkCount: stream.chunkCount,
            ...(stream.lastIndex === undefined ? {} : { lastIndex: stream.lastIndex }),
            ...(stream.error === undefined ? {} : { error: stream.error }),
          },
        };
      }
      return;
    }

    await waitForStreamChangeOrPoll(
      nonNegativeTimerDelay(pollInterval, "Workflow stream follow pollInterval").clampedDelay,
      options.signal,
      waitOptions.waitForChange,
    );
  }
}

export async function waitForStream(
  readInfo: WorkflowStreamInfoReader,
  options: WaitStreamOptions = {},
  waitOptions: WorkflowStreamWaitOptions = {},
): Promise<StreamInfo | undefined> {
  while (true) {
    if (options.signal?.aborted) {
      return undefined;
    }
    try {
      return await readInfo();
    } catch (error) {
      if (!WorkflowStreamNotFoundError.isNotFound(error)) {
        throw error;
      }
    }
    await waitForStreamChangeOrPoll(
      nonNegativeTimerDelay(
        options.pollInterval ?? DEFAULT_STREAM_FOLLOW_POLL_INTERVAL,
        "Workflow stream wait pollInterval",
      ).clampedDelay,
      options.signal,
      waitOptions.waitForChange,
    );
  }
}

export async function waitForStreamChunk<TChunk = unknown>(
  read: WorkflowStreamReader<TChunk>,
  afterIndex: number,
  options: WaitStreamOptions = {},
  waitOptions: WorkflowStreamWaitOptions = {},
): Promise<StreamChunk<TChunk> | undefined> {
  if (!isNonNegativeSafeInteger(afterIndex)) {
    WorkflowOptionsError.nonNegativeSafeInteger("Workflow stream chunk wait afterIndex");
  }
  while (true) {
    if (options.signal?.aborted) {
      return undefined;
    }
    const stream = await read({ fromIndex: afterIndex + 1 });
    const chunk = stream.chunks[0];
    if (chunk !== undefined) {
      return chunk;
    }
    if (stream.status !== "open") {
      return undefined;
    }
    await waitForStreamChangeOrPoll(
      nonNegativeTimerDelay(
        options.pollInterval ?? DEFAULT_STREAM_FOLLOW_POLL_INTERVAL,
        "Workflow stream wait pollInterval",
      ).clampedDelay,
      options.signal,
      waitOptions.waitForChange,
    );
  }
}

export async function waitForStreamTerminal(
  readInfo: WorkflowStreamInfoReader,
  options: WaitStreamOptions = {},
  waitOptions: WorkflowStreamWaitOptions = {},
): Promise<StreamInfo | undefined> {
  while (true) {
    if (options.signal?.aborted === true) {
      return undefined;
    }
    const info = await readInfo();
    if (info.status !== "open") {
      return info;
    }
    await waitForStreamChangeOrPoll(
      nonNegativeTimerDelay(
        options.pollInterval ?? DEFAULT_STREAM_FOLLOW_POLL_INTERVAL,
        "Workflow stream wait pollInterval",
      ).clampedDelay,
      options.signal,
      waitOptions.waitForChange,
    );
  }
}

export function getStreamInfo(
  runId: RunId,
  events: readonly EventRecord[],
  streamIdOrName: StreamIdOrName,
): StreamInfo {
  return getStreamInfoFromHistory(runId, new WorkflowHistory(events), streamIdOrName);
}

function getStreamInfoFromHistory(
  runId: RunId,
  history: WorkflowHistory,
  streamIdOrName: StreamIdOrName,
): StreamInfo {
  return getStreamInfoFromProjection(
    runId,
    requireStreamProjectionFromHistory(history, streamIdOrName),
  );
}

function requireStreamProjectionFromHistory(
  history: WorkflowHistory,
  streamIdOrName: StreamIdOrName,
): StreamEventProjection {
  const projection = history.streamProjection(streamIdOrName);
  if (projection === undefined) {
    WorkflowStreamNotFoundError.notFound(streamIdOrName);
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
    ...(started.contentType === undefined ? {} : { contentType: started.contentType }),
    ...(started.metadata === undefined ? {} : { metadata: started.metadata }),
    chunkCount: chunks.length,
    ...(latestChunk === undefined ? {} : { lastIndex: latestChunk.index }),
    ...(failed === undefined ? {} : { error: failed.event.error }),
  };
}

function requireStreamEventOrder(projection: StreamEventProjection): void {
  const { started, chunks, closed, failed } = projection;
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.event.index !== index) {
      WorkflowStreamError.nonContiguousChunkIndex(started.streamId, chunk.event.index, index);
    }
  }
  const terminal = earliestStreamTerminalEvent(closed, failed);
  if (terminal === undefined) {
    return;
  }
  const lateChunk = chunks.find((chunk) => chunk.index > terminal.index);
  if (lateChunk !== undefined) {
    WorkflowStreamError.chunkAfterTerminal(
      started.streamId,
      lateChunk.event.index,
      terminal.event.kind,
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
  environment: WorkflowExecutionEnvironment,
  identity: WorkflowStepIdentity<"stream">,
  streamId: StreamId,
  contentType: string | undefined,
  metadata: StorageValue | undefined,
): Promise<void> {
  if (environment.history.startedStream(identity.id) !== undefined) {
    return;
  }
  await appendDurableStepStartedEvent(environment, {
    kind: "stream_started",
    timestamp: environment.now(),
    stepId: identity.id,
    stepName: identity.name,
    count: identity.count,
    streamId,
    ...(contentType === undefined ? {} : { contentType }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

async function sleepForStreamFollow(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (milliseconds === 0 || signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function waitForStreamChangeOrPoll(
  milliseconds: number,
  signal: AbortSignal | undefined,
  waitForChange: WorkflowStreamChangeWaiter | undefined,
): Promise<void> {
  if (waitForChange === undefined) {
    await sleepForStreamFollow(milliseconds, signal);
    return;
  }
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted === true) {
      return;
    }
    await Promise.race([
      sleepForStreamFollow(milliseconds, controller.signal),
      waitForChange({ signal: controller.signal }),
    ]);
  } finally {
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

function requireStreamOpen(
  environment: WorkflowExecutionEnvironment,
  stepId: StepId,
  streamId: StreamId,
): void {
  if (
    environment.history.closedStream(stepId) !== undefined ||
    environment.history.failedStream(stepId) !== undefined
  ) {
    WorkflowStreamError.alreadyClosed(streamId);
  }
}

function requireStreamReplayMatches(
  identity: WorkflowStepIdentity<"stream">,
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
  identity: WorkflowStepIdentity<"stream">,
  index: number,
  recorded: StorageValue | undefined,
  next: StorageValue,
): void {
  if (deepEquals(recorded, next)) {
    return;
  }
  WorkflowReplayDivergenceError.diverged(
    `recorded stream ${identity.id} chunk ${index} does not match replayed chunk`,
    {
      expectedStepId: identity.id,
      actualStepId: identity.id,
    },
  );
}
