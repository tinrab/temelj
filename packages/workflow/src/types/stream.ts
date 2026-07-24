import type { StorageValue } from "@temelj/storage";

import type { WorkflowErrorRecord } from "./error.ts";
import type { WorkflowPage, PageOptions } from "./pagination.ts";
import type { RunId } from "./run.ts";
import type { StreamId } from "./stream-id.ts";

/** Writable durable stream created by workflow code and persisted in run history. */
export interface Stream<TChunk = unknown> {
  /** Stable stream ID recorded in workflow history. */
  readonly id: StreamId;
  /** User-facing stream name used to look up the stream. */
  readonly name: string;
  /** Optional MIME type or content type associated with stream chunks. */
  readonly contentType?: string;
  /** Optional persisted stream metadata. */
  readonly metadata?: unknown;
  /** Appends one chunk to the stream. */
  write(chunk: TChunk): Promise<void>;
  /** Closes the stream successfully. */
  close(): Promise<void>;
  /** Fails the stream with an error that readers can observe. */
  error(error: unknown): Promise<void>;
}

/** Options for creating a durable stream from workflow code. */
export interface CreateStreamOptions {
  readonly id?: StreamId;
  readonly contentType?: string;
  readonly metadata?: unknown;
  readonly maximumChunks?: number;
}

/** Options for reading durable stream chunks by index or from the tail. */
export interface ReadStreamOptions {
  readonly fromIndex?: number;
  readonly fromTail?: number;
  readonly maxChunks?: number;
}

/** Paginated stream read options combining stream offsets with cursor paging. */
export type ReadStreamPageOptions = ReadStreamOptions & PageOptions;

/** Options for following stream updates until cancellation or a terminal stream event. */
export interface FollowStreamOptions extends ReadStreamOptions {
  readonly pollInterval?: Temporal.Duration;
  readonly signal?: AbortSignal;
  readonly includeTerminal?: boolean;
  readonly pageSize?: number;
}

/** Options for polling stream availability or terminal state. */
export interface WaitStreamOptions {
  readonly pollInterval?: Temporal.Duration;
  readonly signal?: AbortSignal;
}

/** Terminal-aware status of a durable workflow stream. */
export type StreamStatus = "open" | "closed" | "failed";

/** Single ordered value written to a durable workflow stream. */
export interface StreamChunk<TChunk = unknown> {
  readonly index: number;
  readonly timestamp: Temporal.Instant;
  readonly value: TChunk;
}

/** Current durable stream state including chunk history and optional terminal error. */
export interface StreamState<TChunk = unknown> {
  readonly runId: RunId;
  readonly id: StreamId;
  readonly name: string;
  readonly status: StreamStatus;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly contentType?: string;
  readonly metadata?: StorageValue;
  readonly chunkCount: number;
  readonly lastIndex?: number;
  readonly chunks: readonly StreamChunk<TChunk>[];
  readonly error?: WorkflowErrorRecord;
}

/** Durable stream metadata without chunk contents. */
export interface StreamInfo {
  readonly runId: RunId;
  readonly id: StreamId;
  readonly name: string;
  readonly status: StreamStatus;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly contentType?: string;
  readonly metadata?: StorageValue;
  readonly chunkCount: number;
  readonly lastIndex?: number;
  readonly error?: WorkflowErrorRecord;
}

/** Paginated durable stream state where chunks are returned as a page. */
export interface StreamPage<TChunk = unknown> {
  readonly runId: RunId;
  readonly id: StreamId;
  readonly name: string;
  readonly status: StreamStatus;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly contentType?: string;
  readonly metadata?: StorageValue;
  readonly chunkCount: number;
  readonly lastIndex?: number;
  readonly error?: WorkflowErrorRecord;
  readonly chunks: WorkflowPage<StreamChunk<TChunk>>;
}

/** Incremental update emitted when a durable stream chunk is written. */
export type StreamUpdateKind = "chunk" | "closed" | "failed";

/** Base contract for incremental durable stream updates. */
export interface StreamUpdateBase {
  readonly kind: StreamUpdateKind;
  readonly runId: RunId;
  readonly streamId: StreamId;
  readonly streamName: string;
}

/** Incremental update emitted when a durable stream chunk is written. */
export type StreamChunkUpdate<TChunk = unknown> = StreamUpdateBase & {
  readonly kind: "chunk";
  readonly chunk: StreamChunk<TChunk>;
};

/** Incremental update emitted when a durable stream closes or fails. */
export type StreamTerminalUpdate = StreamUpdateBase & {
  readonly kind: "closed" | "failed";
  readonly info: StreamInfo;
};

/** Incremental durable stream update yielded while following a stream. */
export type StreamUpdate<TChunk = unknown> = StreamChunkUpdate<TChunk> | StreamTerminalUpdate;
