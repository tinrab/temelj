import type { WorkflowErrorCode } from "../types/error-code.ts";
import type { WorkflowErrorDetails, WorkflowErrorRecord } from "../types/error.ts";

import { sanitizedWorkflowErrorDetails, workflowErrorCodeSchema } from "../types/error.ts";
import {
  WorkflowError,
  WorkflowMessageError,
  WorkflowOptionsError,
  WorkflowRunError,
  WorkflowStateError,
  WorkflowStepError,
} from "./base.ts";
import { WorkflowCapabilityError } from "./capability.ts";
import { WorkflowDefinitionError } from "./definition.ts";
import {
  hasWorkflowErrorCauseDetails,
  unprefixWorkflowErrorCauseDetails,
  workflowErrorDetailDuration,
  workflowErrorDetailPositiveSafeInteger,
  workflowErrorDetailString,
  workflowErrorDetailTimestamp,
  workflowErrorRunStatusOrUndefined,
  workflowTerminalErrorRunStatusOrUndefined,
} from "./details.ts";
import {
  WorkflowDurationError,
  WorkflowNonRetryableError,
  WorkflowPermanentFailureError,
  WorkflowReplayDivergenceError,
  WorkflowRetryableError,
  WorkflowSerializationError,
} from "./failures.ts";
import { WorkflowHookError } from "./hook.ts";
import { WorkflowImplementationNotFoundError } from "./implementation.ts";
import { WorkflowLockError, WorkflowLockStateError } from "./lock.ts";
import {
  WorkflowHookDisposedError,
  WorkflowMessageDeliveryError,
  WorkflowMessageIdempotencyConflictError,
  WorkflowMessageWaitTimeoutError,
} from "./message.ts";
import {
  WorkflowChildWorkflowTimeoutError,
  WorkflowResultTimeoutError,
  WorkflowRunCanceledError,
  WorkflowRunCancellationError,
  WorkflowRunDeadlineExceededError,
  WorkflowRunMismatchError,
  WorkflowRunNotFoundError,
  WorkflowRunParentError,
  WorkflowRunTransitionError,
} from "./run.ts";
import { WorkflowRuntimeError } from "./runtime.ts";
import { WorkflowScheduleAlreadyExistsError, WorkflowScheduleError } from "./schedule.ts";
import {
  WorkflowStepAttemptLimitError,
  WorkflowStepExecutionError,
  WorkflowStepRetryLimitError,
  WorkflowStepTimeoutError,
} from "./step.ts";
import { WorkflowStreamError, WorkflowStreamNotFoundError } from "./stream.ts";

/** Reconstructs a workflow error instance from a persisted error record. */
export function workflowErrorFromRecord(record: WorkflowErrorRecord): WorkflowError {
  const normalizedRecord =
    typeof record === "object" &&
    record !== null &&
    !Array.isArray(record) &&
    (Object.getPrototypeOf(record) === Object.prototype || Object.getPrototypeOf(record) === null)
      ? (record as Partial<WorkflowErrorRecord>)
      : {};
  const recordName =
    typeof normalizedRecord.name === "string" && normalizedRecord.name.trim() !== ""
      ? normalizedRecord.name
      : "WorkflowError";
  const recordMessage =
    typeof normalizedRecord.message === "string" && normalizedRecord.message.trim() !== ""
      ? normalizedRecord.message
      : recordName;
  const error =
    typedWorkflowErrorFromRecord(normalizedRecord, recordMessage) ??
    WorkflowError.fromMessage(recordMessage, {
      details: sanitizedWorkflowErrorDetails(normalizedRecord.details),
    });
  error.name = recordName;
  error.message = recordMessage;
  const recordCode = workflowErrorCodeSchema.safeParse(normalizedRecord.code);
  if (recordCode.success) {
    Object.defineProperty(error, "code", { value: recordCode.data });
  }
  const recordStack =
    typeof normalizedRecord.stack === "string" && normalizedRecord.stack.trim() !== ""
      ? normalizedRecord.stack
      : undefined;
  if (recordStack !== undefined) {
    error.stack = recordStack;
  }
  return error;
}

function typedWorkflowErrorFromRecord(
  record: Partial<WorkflowErrorRecord>,
  recordMessage: string,
): WorkflowError | undefined {
  const factory = record.name === undefined ? undefined : workflowErrorRecordFactories[record.name];
  return factory?.(record, recordMessage);
}

type WorkflowErrorRecordFactory = (
  record: Partial<WorkflowErrorRecord>,
  recordMessage: string,
) => WorkflowError | undefined;

const workflowErrorRecordFactories: Record<string, WorkflowErrorRecordFactory> = {
  WorkflowHookError: domainWorkflowErrorFactory(WorkflowHookError),
  WorkflowLockError: domainWorkflowErrorFactory(WorkflowLockError),
  WorkflowLockStateError: domainWorkflowErrorFactory(WorkflowLockStateError),
  WorkflowScheduleError: domainWorkflowErrorFactory(WorkflowScheduleError),
  WorkflowStreamError: domainWorkflowErrorFactory(WorkflowStreamError),
  WorkflowScheduleAlreadyExistsError(record) {
    const scheduleId = workflowErrorDetailString(record.details, "scheduleId");
    return scheduleId === undefined
      ? undefined
      : WorkflowScheduleAlreadyExistsError.create(scheduleId);
  },
  WorkflowStreamNotFoundError(record) {
    const streamIdOrName = workflowErrorDetailString(record.details, "streamIdOrName");
    return streamIdOrName === undefined
      ? undefined
      : WorkflowStreamNotFoundError.create(streamIdOrName);
  },
  WorkflowImplementationNotFoundError(record) {
    const details = record.details;
    const workflowName = workflowErrorDetailString(details, "workflowName");
    if (workflowName === undefined) {
      return undefined;
    }
    return WorkflowImplementationNotFoundError.create(
      workflowName,
      workflowErrorDetailString(details, "workflowVersion"),
    );
  },
  WorkflowDefinitionError: (_record, recordMessage) =>
    WorkflowDefinitionError.create(recordMessage),
  WorkflowOptionsError: (_record, recordMessage) => WorkflowOptionsError.create(recordMessage),
  WorkflowStateError: (_record, recordMessage) => WorkflowStateError.create(recordMessage),
  WorkflowRuntimeError: (_record, recordMessage) => WorkflowRuntimeError.create(recordMessage),
  WorkflowRunError(record, recordMessage) {
    return WorkflowRunError.fromMessage(recordMessage, {
      details: sanitizedWorkflowErrorDetails(record.details),
    });
  },
  WorkflowStepError(record, recordMessage) {
    return WorkflowStepError.fromMessage(recordMessage, {
      details: sanitizedWorkflowErrorDetails(record.details),
    });
  },
  WorkflowMessageError(record, recordMessage) {
    return WorkflowMessageError.fromMessage(recordMessage, {
      details: sanitizedWorkflowErrorDetails(record.details),
    });
  },
  WorkflowCapabilityError(record) {
    const details = record.details;
    const capability = workflowErrorDetailString(details, "capability");
    return capability === undefined ? undefined : WorkflowCapabilityError.create(capability);
  },
  WorkflowDurationError: (_record, recordMessage) => WorkflowDurationError.create(recordMessage),
  WorkflowSerializationError(record) {
    const details = record.details;
    const path = workflowErrorDetailString(details, "path");
    const reason = workflowErrorDetailString(details, "reason");
    return path === undefined || reason === undefined
      ? undefined
      : WorkflowSerializationError.create(path, reason);
  },
  WorkflowNonRetryableError(record, recordMessage) {
    return WorkflowNonRetryableError.create(recordMessage, {
      details: sanitizedWorkflowErrorDetails(record.details),
    });
  },
  WorkflowPermanentFailureError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const reason = workflowErrorDetailString(details, "reason");
    return runId === undefined || reason === undefined
      ? undefined
      : WorkflowPermanentFailureError.create({ runId, reason });
  },
  WorkflowRetryableError(record, recordMessage) {
    const details = record.details;
    const retryAt = workflowErrorDetailTimestamp(details, "retryAt");
    const retryDelay = workflowErrorDetailDuration(details, "retryDelay");
    return WorkflowRetryableError.create(recordMessage, {
      ...(retryAt === undefined ? {} : { retryAt }),
      ...(retryDelay === undefined ? {} : { retryDelay }),
      details: sanitizedWorkflowErrorDetails(details),
    });
  },
  WorkflowStepTimeoutError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const stepId = workflowErrorDetailString(details, "stepId");
    const stepName = workflowErrorDetailString(details, "stepName");
    const attempt = workflowErrorDetailPositiveSafeInteger(details, "attempt");
    const timeoutAt = workflowErrorDetailTimestamp(details, "timeoutAt");
    return runId === undefined ||
      stepId === undefined ||
      stepName === undefined ||
      attempt === undefined ||
      timeoutAt === undefined
      ? undefined
      : WorkflowStepTimeoutError.create({ runId, stepId, stepName, attempt, timeoutAt });
  },
  WorkflowResultTimeoutError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const timeout = workflowErrorDetailDuration(details, "timeout");
    return runId === undefined || timeout === undefined
      ? undefined
      : WorkflowResultTimeoutError.create(runId, timeout);
  },
  WorkflowRunNotFoundError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    return runId === undefined ? undefined : WorkflowRunNotFoundError.create(runId);
  },
  WorkflowRunCanceledError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    return runId === undefined ? undefined : WorkflowRunCanceledError.create(runId);
  },
  WorkflowRunCancellationError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const status = workflowTerminalErrorRunStatusOrUndefined(
      workflowErrorDetailString(details, "status"),
    );
    return runId === undefined || status === undefined
      ? undefined
      : WorkflowRunCancellationError.create(runId, status);
  },
  WorkflowRunDeadlineExceededError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const deadlineAt = workflowErrorDetailTimestamp(details, "deadlineAt");
    return runId === undefined || deadlineAt === undefined
      ? undefined
      : WorkflowRunDeadlineExceededError.create(runId, deadlineAt);
  },
  WorkflowRunParentError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const reason = workflowErrorDetailString(details, "reason");
    return runId === undefined || reason === undefined
      ? undefined
      : WorkflowRunParentError.create(runId, reason);
  },
  WorkflowRunTransitionError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const valueFrom = workflowErrorDetailString(details, "from");
    const from = valueFrom === undefined ? undefined : workflowErrorRunStatusOrUndefined(valueFrom);
    const valueTo = workflowErrorDetailString(details, "to");
    const to = valueTo === undefined ? undefined : workflowErrorRunStatusOrUndefined(valueTo);
    return runId === undefined || from === undefined || to === undefined
      ? undefined
      : WorkflowRunTransitionError.create(runId, from, to);
  },
  WorkflowMessageDeliveryError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const status = workflowTerminalErrorRunStatusOrUndefined(
      workflowErrorDetailString(details, "status"),
    );
    const messageId = workflowErrorDetailString(details, "messageId");
    return runId === undefined || status === undefined || messageId === undefined
      ? undefined
      : WorkflowMessageDeliveryError.create({ runId, status, messageId });
  },
  WorkflowMessageIdempotencyConflictError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const messageId = workflowErrorDetailString(details, "messageId");
    const idempotencyKey = workflowErrorDetailString(details, "idempotencyKey");
    return runId === undefined || messageId === undefined || idempotencyKey === undefined
      ? undefined
      : WorkflowMessageIdempotencyConflictError.create({ runId, messageId, idempotencyKey });
  },
  WorkflowRunMismatchError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const expectedWorkflowName = workflowErrorDetailString(details, "expectedWorkflowName");
    const actualWorkflowName = workflowErrorDetailString(details, "actualWorkflowName");
    return runId === undefined ||
      expectedWorkflowName === undefined ||
      actualWorkflowName === undefined
      ? undefined
      : WorkflowRunMismatchError.create({ runId, expectedWorkflowName, actualWorkflowName });
  },
  WorkflowChildWorkflowTimeoutError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const childRunId = workflowErrorDetailString(details, "childRunId");
    const stepId = workflowErrorDetailString(details, "stepId");
    const timeoutAt = workflowErrorDetailTimestamp(details, "timeoutAt");
    return runId === undefined ||
      childRunId === undefined ||
      stepId === undefined ||
      timeoutAt === undefined
      ? undefined
      : WorkflowChildWorkflowTimeoutError.create({ runId, childRunId, stepId, timeoutAt });
  },
  WorkflowMessageWaitTimeoutError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const stepId = workflowErrorDetailString(details, "stepId");
    const stepName = workflowErrorDetailString(details, "stepName");
    const messageId = workflowErrorDetailString(details, "messageId");
    const timeoutAt = workflowErrorDetailTimestamp(details, "timeoutAt");
    return runId === undefined ||
      stepId === undefined ||
      stepName === undefined ||
      messageId === undefined ||
      timeoutAt === undefined
      ? undefined
      : WorkflowMessageWaitTimeoutError.create({ runId, stepId, stepName, messageId, timeoutAt });
  },
  WorkflowHookDisposedError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const stepId = workflowErrorDetailString(details, "stepId");
    const stepName = workflowErrorDetailString(details, "stepName");
    const messageId = workflowErrorDetailString(details, "messageId");
    return runId === undefined ||
      stepId === undefined ||
      stepName === undefined ||
      messageId === undefined
      ? undefined
      : WorkflowHookDisposedError.create({ runId, stepId, stepName, messageId });
  },
  WorkflowStepExecutionError(record, recordMessage) {
    const details = record.details;
    const stepId = workflowErrorDetailString(details, "stepId");
    const stepName = workflowErrorDetailString(details, "stepName");
    const attempt = workflowErrorDetailPositiveSafeInteger(details, "attempt");
    const cause =
      details !== undefined && hasWorkflowErrorCauseDetails(details)
        ? workflowErrorFromRecord(unprefixWorkflowErrorCauseDetails(details))
        : WorkflowError.fromMessage(recordMessage);
    return stepId === undefined || stepName === undefined || attempt === undefined
      ? undefined
      : WorkflowStepExecutionError.create({
          stepId,
          stepName,
          attempt,
          cause,
        });
  },
  WorkflowStepRetryLimitError(record) {
    const details = record.details;
    const stepId = workflowErrorDetailString(details, "stepId");
    const stepName = workflowErrorDetailString(details, "stepName");
    const attempt = workflowErrorDetailPositiveSafeInteger(details, "attempt");
    return stepId === undefined || stepName === undefined || attempt === undefined
      ? undefined
      : WorkflowStepRetryLimitError.create({ stepId, stepName, attempt });
  },
  WorkflowStepAttemptLimitError(record) {
    const details = record.details;
    const runId = workflowErrorDetailString(details, "runId");
    const maximumAttempts = workflowErrorDetailPositiveSafeInteger(details, "maximumAttempts");
    return runId === undefined || maximumAttempts === undefined
      ? undefined
      : WorkflowStepAttemptLimitError.create(runId, maximumAttempts);
  },
  WorkflowReplayDivergenceError(record) {
    const details = record.details;
    if (typeof record.message !== "string" || record.message.trim() === "") {
      return undefined;
    }
    return WorkflowReplayDivergenceError.create(
      record.message.replace(/^Workflow replay diverged: /, ""),
      {
        expectedStepId: workflowErrorDetailString(details, "expectedStepId"),
        actualStepId: workflowErrorDetailString(details, "actualStepId"),
      },
    );
  },
};

interface WorkflowDomainErrorConstructor {
  new (message: string, code: WorkflowErrorCode, details?: WorkflowErrorDetails): WorkflowError;
}

function domainWorkflowErrorFactory(
  ErrorConstructor: WorkflowDomainErrorConstructor,
): WorkflowErrorRecordFactory {
  return (record, recordMessage) => {
    const code = workflowErrorCodeSchema.safeParse(record.code);
    return code.success
      ? new ErrorConstructor(
          recordMessage,
          code.data,
          sanitizedWorkflowErrorDetails(record.details),
        )
      : undefined;
  };
}
