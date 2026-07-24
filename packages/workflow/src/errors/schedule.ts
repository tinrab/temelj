import type { WorkflowErrorCode as WorkflowErrorCodeType } from "../types/error-code.ts";
import type { WorkflowErrorDetails } from "../types/error.ts";
import type { ScheduleId } from "../types/schedule.ts";

import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowStateError } from "./base.ts";
import { workflowErrorRecordView } from "./record-view.ts";

/** Errors caused by invalid persisted schedule state or exhausted schedule updates. */
export class WorkflowScheduleError extends WorkflowStateError {
  constructor(
    message: string,
    code: WorkflowErrorCodeType,
    details?: WorkflowErrorDetails,
    context?: Function,
  ) {
    super(message, context, { code, details });
    this.name = "WorkflowScheduleError";
  }

  static namespaceMismatch(this: void, actual: string, expected: string): never {
    throw new WorkflowScheduleError(
      `Workflow schedule namespace mismatch: ${actual} !== ${expected}`,
      WorkflowErrorCode.SCHEDULE_NAMESPACE_MISMATCH,
      { actual, expected },
      WorkflowScheduleError.namespaceMismatch,
    );
  }

  static recordInvalid(this: void): never {
    throw new WorkflowScheduleError(
      "Workflow schedule record is invalid",
      WorkflowErrorCode.SCHEDULE_RECORD_INVALID,
      undefined,
      WorkflowScheduleError.recordInvalid,
    );
  }

  static idChangeRejected(this: void): never {
    throw new WorkflowScheduleError(
      "Workflow schedule id cannot change",
      WorkflowErrorCode.SCHEDULE_ID_CHANGE_REJECTED,
      undefined,
      WorkflowScheduleError.idChangeRejected,
    );
  }

  static currentRecordInvalid(this: void): never {
    throw new WorkflowScheduleError(
      "Current workflow schedule record is invalid",
      WorkflowErrorCode.SCHEDULE_CURRENT_RECORD_INVALID,
      undefined,
      WorkflowScheduleError.currentRecordInvalid,
    );
  }

  static nextRecordInvalid(this: void): never {
    throw new WorkflowScheduleError(
      "Next workflow schedule record is invalid",
      WorkflowErrorCode.SCHEDULE_NEXT_RECORD_INVALID,
      undefined,
      WorkflowScheduleError.nextRecordInvalid,
    );
  }

  static upsertConflictExhausted(this: void, scheduleId: ScheduleId): never {
    throw new WorkflowScheduleError(
      `Failed to upsert workflow schedule ${scheduleId}`,
      WorkflowErrorCode.SCHEDULE_UPSERT_CONFLICT_EXHAUSTED,
      { scheduleId },
      WorkflowScheduleError.upsertConflictExhausted,
    );
  }

  static notFound(this: void, scheduleId: ScheduleId): never {
    throw new WorkflowScheduleError(
      `Workflow schedule not found: ${scheduleId}`,
      WorkflowErrorCode.SCHEDULE_NOT_FOUND,
      { scheduleId },
      WorkflowScheduleError.notFound,
    );
  }

  static updateConflictExhausted(this: void, scheduleId: ScheduleId): never {
    throw new WorkflowScheduleError(
      `Failed to update workflow schedule ${scheduleId}`,
      WorkflowErrorCode.SCHEDULE_UPDATE_CONFLICT_EXHAUSTED,
      { scheduleId },
      WorkflowScheduleError.updateConflictExhausted,
    );
  }
}

/** Error thrown when creating a schedule whose id is already stored. */
export class WorkflowScheduleAlreadyExistsError extends WorkflowStateError {
  public readonly scheduleId: ScheduleId;

  constructor(scheduleId: ScheduleId, context?: Function) {
    super(`Workflow schedule already exists: ${scheduleId}`, context, {
      code: WorkflowErrorCode.SCHEDULE_ALREADY_EXISTS,
      details: { scheduleId },
    });
    this.name = "WorkflowScheduleAlreadyExistsError";
    this.scheduleId = scheduleId;
  }

  static alreadyExists(this: void, scheduleId: ScheduleId): never {
    throw new WorkflowScheduleAlreadyExistsError(
      scheduleId,
      WorkflowScheduleAlreadyExistsError.alreadyExists,
    );
  }

  static create(this: void, scheduleId: ScheduleId): WorkflowScheduleAlreadyExistsError {
    return new WorkflowScheduleAlreadyExistsError(
      scheduleId,
      WorkflowScheduleAlreadyExistsError.create,
    );
  }

  static isAlreadyExists(error: unknown, scheduleId?: ScheduleId): boolean {
    const record = workflowErrorRecordView(error);
    return (
      record?.code === WorkflowErrorCode.SCHEDULE_ALREADY_EXISTS &&
      (scheduleId === undefined || record.details?.scheduleId === scheduleId)
    );
  }
}
