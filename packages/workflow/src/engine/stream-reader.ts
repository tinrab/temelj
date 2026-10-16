// Installs Temporal when the runtime lacks it, before any module uses it.
import "temporal-polyfill/global";
import type { RunId, StreamIdOrName } from "../types/ids.ts";
import type {
  FollowStreamOptions,
  ReadStreamOptions,
  StreamInfo,
  StreamChunk,
  StreamState,
  StreamUpdate,
  WaitStreamOptions,
} from "../types/stream.ts";
import type { EngineContext } from "./context.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowOptionsError, WorkflowStreamError, matchesWorkflowError } from "../errors/mod.ts";
import { History } from "../history/replay.ts";
import { getRequiredRun } from "../store/query.ts";
import { nonNegativeTimerDelay } from "../timer.ts";
import { isNonNegativeSafeInteger } from "../values.ts";
import { getStreamInfoFromHistory, readStreamFromHistory } from "./stream.ts";

const DEFAULT_STREAM_FOLLOW_POLL_INTERVAL = Temporal.Duration.from({ milliseconds: 100 });

interface StreamStateReader<TChunk> {
  (options?: ReadStreamOptions): Promise<StreamState<TChunk>>;
}

interface StreamInfoReader {
  (): Promise<StreamInfo>;
}

interface StreamChangeWaiter {
  (options: { readonly signal?: AbortSignal }): Promise<void>;
}

interface StreamWaitOptions {
  readonly waitForChange?: StreamChangeWaiter;
}

export async function getStreamInfo(
  context: EngineContext,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
): Promise<StreamInfo> {
  await getRequiredRun(context.store, runId);

  return getStreamInfoFromHistory(
    runId,
    new History(await context.store.getEvents(runId)),
    streamIdOrName,
  );
}

export async function readStream(
  context: EngineContext,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  readOptions?: ReadStreamOptions,
): Promise<StreamState> {
  await getRequiredRun(context.store, runId);

  return readStreamFromHistory(
    runId,
    new History(await context.store.getEvents(runId)),
    streamIdOrName,
    readOptions,
  );
}

export function followStream(
  context: EngineContext,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  followOptions?: FollowStreamOptions,
): AsyncIterable<StreamUpdate> {
  return followStreamState(
    (readOptions) => readStream(context, runId, streamIdOrName, readOptions),
    followOptions,
    {
      waitForChange: ({ signal }) => waitForStreamStorageChange(context, runId, signal),
    },
  );
}

export async function waitForStream(
  context: EngineContext,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  waitOptions?: WaitStreamOptions,
): Promise<StreamInfo | undefined> {
  return await waitForStreamState(
    () => getStreamInfo(context, runId, streamIdOrName),
    waitOptions,
    {
      waitForChange: ({ signal }) => waitForStreamStorageChange(context, runId, signal),
    },
  );
}

export async function waitForStreamChunk(
  context: EngineContext,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  afterIndex: number,
  waitOptions?: WaitStreamOptions,
): Promise<StreamChunk | undefined> {
  return await waitForStreamStateChunk(
    (readOptions) => readStream(context, runId, streamIdOrName, readOptions),
    afterIndex,
    waitOptions,
    {
      waitForChange: ({ signal }) => waitForStreamStorageChange(context, runId, signal),
    },
  );
}

export async function waitForStreamTerminal(
  context: EngineContext,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  waitOptions?: WaitStreamOptions,
): Promise<StreamInfo | undefined> {
  return await waitForStreamStateTerminal(
    () => getStreamInfo(context, runId, streamIdOrName),
    waitOptions,
    {
      waitForChange: ({ signal }) => waitForStreamStorageChange(context, runId, signal),
    },
  );
}

async function waitForStreamStorageChange(
  context: EngineContext,
  runId: RunId,
  signal: AbortSignal | undefined,
): Promise<void> {
  await context.store.waitForEventHistoryChange(runId, { signal });
}

async function* followStreamState<TChunk = unknown>(
  read: StreamStateReader<TChunk>,
  options: FollowStreamOptions = {},
  waitOptions: StreamWaitOptions = {},
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

    const readOptions: ReadStreamOptions = {
      fromIndex: nextIndex,
      fromTail: nextIndex === undefined ? initialFromTail : undefined,
      maxChunks,
    };

    const stream = await read(readOptions);

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
        const info: StreamInfo = {
          runId: stream.runId,
          id: stream.id,
          name: stream.name,
          status: stream.status,
          createdAt: stream.createdAt,
          updatedAt: stream.updatedAt,
          contentType: stream.contentType,
          metadata: stream.metadata,
          chunkCount: stream.chunkCount,
          lastIndex: stream.lastIndex,
          error: stream.error,
        };

        yield {
          kind: stream.status,
          runId: stream.runId,
          streamId: stream.id,
          streamName: stream.name,
          info,
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

/** Waits for the next stream change, or for one poll interval when changes cannot be watched. */
async function pollForStreamChange(
  options: WaitStreamOptions,
  waitOptions: StreamWaitOptions,
): Promise<void> {
  await waitForStreamChangeOrPoll(
    nonNegativeTimerDelay(
      options.pollInterval ?? DEFAULT_STREAM_FOLLOW_POLL_INTERVAL,
      "Workflow stream wait pollInterval",
    ).clampedDelay,
    options.signal,
    waitOptions.waitForChange,
  );
}

async function waitForStreamState(
  readInfo: StreamInfoReader,
  options: WaitStreamOptions = {},
  waitOptions: StreamWaitOptions = {},
): Promise<StreamInfo | undefined> {
  while (true) {
    if (options.signal?.aborted) {
      return undefined;
    }

    try {
      return await readInfo();
    } catch (error) {
      if (!matchesWorkflowError(error, WorkflowErrorCode.STREAM_NOT_FOUND)) {
        throw error;
      }
    }

    await pollForStreamChange(options, waitOptions);
  }
}

async function waitForStreamStateChunk<TChunk = unknown>(
  read: StreamStateReader<TChunk>,
  afterIndex: number,
  options: WaitStreamOptions = {},
  waitOptions: StreamWaitOptions = {},
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

    await pollForStreamChange(options, waitOptions);
  }
}

async function waitForStreamStateTerminal(
  readInfo: StreamInfoReader,
  options: WaitStreamOptions = {},
  waitOptions: StreamWaitOptions = {},
): Promise<StreamInfo | undefined> {
  while (true) {
    if (options.signal?.aborted === true) {
      return undefined;
    }

    const info = await readInfo();

    if (info.status !== "open") {
      return info;
    }

    await pollForStreamChange(options, waitOptions);
  }
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
  waitForChange: StreamChangeWaiter | undefined,
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
