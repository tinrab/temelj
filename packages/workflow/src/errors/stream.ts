import type { ErrorDetails } from "../types/error.ts";
import type { StreamIdOrName } from "../types/ids.ts";

import { WorkflowOptionsError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

/** Errors caused by invalid stream operations or stream history. */
export class WorkflowStreamError extends WorkflowOptionsError {
  constructor(message: string, code: WorkflowErrorCode, details?: ErrorDetails) {
    super(message, { code, details });
    this.name = "WorkflowStreamError";
  }

  static readOffsetConflict(this: void): never {
    throw new WorkflowStreamError(
      "Cannot include both fromIndex and fromTail",
      WorkflowErrorCode.STREAM_READ_OFFSET_CONFLICT,
      undefined,
    );
  }
}

/** Error thrown when a requested workflow stream cannot be found. */
export class WorkflowStreamNotFoundError extends WorkflowOptionsError {
  public readonly streamIdOrName: StreamIdOrName;

  constructor(streamIdOrName: StreamIdOrName) {
    super(`Workflow stream was not found: ${streamIdOrName}`, {
      code: WorkflowErrorCode.STREAM_NOT_FOUND,
      details: { streamIdOrName },
    });
    this.name = "WorkflowStreamNotFoundError";
    this.streamIdOrName = streamIdOrName;
  }
}
