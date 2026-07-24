import type { WorkflowErrorCode as WorkflowErrorCodeType } from "../types/error-code.ts";
import type { WorkflowErrorDetails } from "../types/error.ts";
import type { StreamIdOrName } from "../types/stream-id.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowOptionsError } from "./base.ts";
import { workflowErrorRecordView } from "./record-view.ts";

/** Errors caused by invalid stream operations or stream history. */
export class WorkflowStreamError extends WorkflowOptionsError {
  constructor(
    message: string,
    code: WorkflowErrorCodeType,
    details?: WorkflowErrorDetails,
    context?: Function,
  ) {
    super(message, context, { code, details });
    this.name = "WorkflowStreamError";
  }

  static chunkLimitExceeded(this: void, streamId: string, maximumChunks: number): never {
    throw new WorkflowStreamError(
      `Workflow stream ${streamId} chunk count would exceed maximumStreamChunks ${maximumChunks}`,
      WorkflowErrorCode.STREAM_CHUNK_LIMIT_EXCEEDED,
      { streamId, maximumChunks },
      WorkflowStreamError.chunkLimitExceeded,
    );
  }

  static readOffsetConflict(this: void): never {
    throw new WorkflowStreamError(
      "Cannot include both fromIndex and fromTail",
      WorkflowErrorCode.STREAM_READ_OFFSET_CONFLICT,
      undefined,
      WorkflowStreamError.readOffsetConflict,
    );
  }

  static nonContiguousChunkIndex(
    this: void,
    streamId: string,
    actualIndex: number,
    expectedIndex: number,
  ): never {
    throw new WorkflowStreamError(
      `Workflow stream ${streamId} has non-contiguous chunk index ${actualIndex}; expected ${expectedIndex}`,
      WorkflowErrorCode.STREAM_CHUNK_INDEX_NON_CONTIGUOUS,
      { streamId, actualIndex, expectedIndex },
      WorkflowStreamError.nonContiguousChunkIndex,
    );
  }

  static chunkAfterTerminal(
    this: void,
    streamId: string,
    chunkIndex: number,
    terminalKind: string,
  ): never {
    throw new WorkflowStreamError(
      `Workflow stream ${streamId} has chunk ${chunkIndex} after terminal event ${terminalKind}`,
      WorkflowErrorCode.STREAM_CHUNK_AFTER_TERMINAL,
      { streamId, chunkIndex, terminalKind },
      WorkflowStreamError.chunkAfterTerminal,
    );
  }

  static alreadyClosed(this: void, streamId: string): never {
    throw new WorkflowStreamError(
      `Workflow stream is already closed: ${streamId}`,
      WorkflowErrorCode.STREAM_ALREADY_CLOSED,
      { streamId },
      WorkflowStreamError.alreadyClosed,
    );
  }
}

/** Error thrown when a requested workflow stream cannot be found. */
export class WorkflowStreamNotFoundError extends WorkflowOptionsError {
  public readonly streamIdOrName: StreamIdOrName;

  constructor(streamIdOrName: StreamIdOrName, context?: Function) {
    super(`Workflow stream was not found: ${streamIdOrName}`, context, {
      code: WorkflowErrorCode.STREAM_NOT_FOUND,
      details: { streamIdOrName },
    });
    this.name = "WorkflowStreamNotFoundError";
    this.streamIdOrName = streamIdOrName;
  }

  static notFound(this: void, streamIdOrName: StreamIdOrName): never {
    throw new WorkflowStreamNotFoundError(streamIdOrName, WorkflowStreamNotFoundError.notFound);
  }

  static create(this: void, streamIdOrName: StreamIdOrName): WorkflowStreamNotFoundError {
    return new WorkflowStreamNotFoundError(streamIdOrName, WorkflowStreamNotFoundError.create);
  }

  static isNotFound(error: unknown, streamIdOrName?: StreamIdOrName): boolean {
    const record = workflowErrorRecordView(error);
    return (
      record?.code === WorkflowErrorCode.STREAM_NOT_FOUND &&
      (streamIdOrName === undefined || record.details?.streamIdOrName === streamIdOrName)
    );
  }
}
