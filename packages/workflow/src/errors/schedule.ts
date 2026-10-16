import type { ErrorDetails } from "../types/error.ts";
import type { ScheduleId } from "../types/schedule.ts";

import { WorkflowStateError } from "./base.ts";
import { WorkflowErrorCode } from "./codes.ts";

/** Errors caused by invalid persisted schedule state or exhausted schedule updates. */
export class WorkflowScheduleError extends WorkflowStateError {
  constructor(message: string, code: WorkflowErrorCode, details?: ErrorDetails) {
    super(message, { code, details });
    this.name = "WorkflowScheduleError";
  }

  static namespaceMismatch(this: void, actual: string, expected: string): never {
    throw new WorkflowScheduleError(
      `Workflow schedule namespace mismatch: ${actual} !== ${expected}`,
      WorkflowErrorCode.SCHEDULE_NAMESPACE_MISMATCH,
      { actual, expected },
    );
  }
}

/** Error thrown when creating a schedule whose id is already stored. */
export class WorkflowScheduleAlreadyExistsError extends WorkflowStateError {
  public readonly scheduleId: ScheduleId;

  constructor(scheduleId: ScheduleId) {
    super(`Workflow schedule already exists: ${scheduleId}`, {
      code: WorkflowErrorCode.SCHEDULE_ALREADY_EXISTS,
      details: { scheduleId },
    });
    this.name = "WorkflowScheduleAlreadyExistsError";
    this.scheduleId = scheduleId;
  }
}
