import { ss } from "@temelj/standard-schema";
import { isObject, isString } from "@temelj/value";

import type { ErrorDetails, WorkflowErrorOptions, WorkflowErrorRecord } from "../types/error.ts";
import type { RunStatus, TerminalRunStatus } from "../types/run.ts";
import type { WorkflowErrorCode } from "./codes.ts";

import { positiveSafeIntegerSchema } from "../schema/common.ts";
import {
  errorCodeSchema,
  errorDetailsSchema,
  optionalErrorStringSchema,
  errorRunStatusSchema,
  terminalErrorRunStatusSchema,
} from "../schema/error.ts";
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
  const recordName = record.name.trim() === "" ? "WorkflowError" : record.name;
  const recordMessage = record.message.trim() === "" ? recordName : record.message;

  const error =
    typedErrorFromRecord(record, recordMessage) ??
    new WorkflowError(recordMessage, {
      details: sanitizedErrorDetails(record.details),
    });

  error.name = recordName;
  error.message = recordMessage;
  const recordCode = ss.safeParseSync(errorCodeSchema, record.code);

  if (recordCode.success) {
    Object.defineProperty(error, "code", { value: recordCode.value });
  }

  const recordStack =
    record.stack !== undefined && record.stack.trim() !== "" ? record.stack : undefined;

  if (recordStack !== undefined) {
    error.stack = recordStack;
  }

  return error;
}

function typedErrorFromRecord(
  record: Partial<WorkflowErrorRecord>,
  recordMessage: string,
): WorkflowError | undefined {
  const factory =
    record.name === undefined ? undefined : workflowErrorRecordFactories().get(record.name);

  return factory?.(record, recordMessage);
}

type ErrorRecordFactory = (
  record: Partial<WorkflowErrorRecord>,
  recordMessage: string,
) => WorkflowError | undefined;

interface FieldTypes {
  readonly string: string;
  readonly integer: number;
  readonly instant: Temporal.Instant;
  readonly duration: Temporal.Duration;
  readonly runStatus: RunStatus;
  readonly terminalStatus: TerminalRunStatus;
}

type FieldKind = keyof FieldTypes;

type Fields<Spec extends Record<string, FieldKind>> = {
  readonly [Key in keyof Spec]: FieldTypes[Spec[Key]];
};

/**
 * Rebuilds an error from the detail fields its constructor needs. The record is not rebuilt as
 * this class when a field is missing or malformed.
 */
function fromFields<const Spec extends Record<string, FieldKind>>(
  spec: Spec,
  build: (
    fields: Fields<Spec>,
    recordMessage: string,
    details: ErrorDetails | undefined,
  ) => WorkflowError,
): ErrorRecordFactory {
  return (record, recordMessage) => {
    const fields: Record<string, FieldTypes[FieldKind]> = {};

    for (const [key, kind] of Object.entries(spec)) {
      const value = readField(record.details, key, kind);

      if (value === undefined) {
        return undefined;
      }

      fields[key] = value;
    }

    // SAFETY: Every key of the spec was read with the parser for its kind.
    return build(fields as Fields<Spec>, recordMessage, record.details);
  };
}

function readField(
  details: ErrorDetails | undefined,
  key: string,
  kind: FieldKind,
): FieldTypes[FieldKind] | undefined {
  switch (kind) {
    case "string":
      return workflowErrorDetailString(details, key);
    case "integer":
      return workflowErrorDetailPositiveSafeInteger(details, key);
    case "instant":
      return workflowErrorDetailTimestamp(details, key);
    case "duration":
      return workflowErrorDetailDuration(details, key);
    case "runStatus":
      return workflowErrorRunStatusOrUndefined(workflowErrorDetailString(details, key));
    case "terminalStatus":
      return workflowTerminalErrorRunStatusOrUndefined(workflowErrorDetailString(details, key));
    default: {
      const exhaustive: never = kind;

      return exhaustive;
    }
  }
}

let recordFactories: ReadonlyMap<string, ErrorRecordFactory> | undefined;

/** Built on first use, because the error modules import this one while they load. */
function workflowErrorRecordFactories(): ReadonlyMap<string, ErrorRecordFactory> {
  recordFactories ??= new Map<string, ErrorRecordFactory>(
    Object.entries({
      WorkflowHookError: domainErrorFactory(WorkflowHookError),
      WorkflowLockError: domainErrorFactory(WorkflowLockError),
      WorkflowLockStateError: domainErrorFactory(WorkflowLockStateError),
      WorkflowScheduleError: domainErrorFactory(WorkflowScheduleError),
      WorkflowStreamError: domainErrorFactory(WorkflowStreamError),
      WorkflowScheduleAlreadyExistsError: fromFields(
        { scheduleId: "string" },
        ({ scheduleId }) => new WorkflowScheduleAlreadyExistsError(scheduleId),
      ),
      WorkflowStreamNotFoundError: fromFields(
        { streamIdOrName: "string" },
        ({ streamIdOrName }) => new WorkflowStreamNotFoundError(streamIdOrName),
      ),
      WorkflowImplementationNotFoundError: fromFields(
        { workflowName: "string" },
        ({ workflowName }, _message, details) =>
          new WorkflowImplementationNotFoundError(
            workflowName,
            workflowErrorDetailString(details, "workflowVersion"),
          ),
      ),
      WorkflowDefinitionError: (_record, recordMessage) =>
        new WorkflowDefinitionError(recordMessage),
      WorkflowOptionsError: (_record, recordMessage) => new WorkflowOptionsError(recordMessage),
      WorkflowStateError: (_record, recordMessage) => new WorkflowStateError(recordMessage),
      WorkflowDurationError: (_record, recordMessage) => new WorkflowDurationError(recordMessage),
      WorkflowRunError: withDetails(WorkflowRunError),
      WorkflowStepError: withDetails(WorkflowStepError),
      WorkflowMessageError: withDetails(WorkflowMessageError),
      WorkflowNonRetryableError: withDetails(WorkflowNonRetryableError),
      WorkflowCapabilityError: fromFields(
        { capability: "string" },
        ({ capability }) => new WorkflowCapabilityError(capability),
      ),
      WorkflowSerializationError: fromFields(
        { path: "string", reason: "string" },
        ({ path, reason }) => new WorkflowSerializationError(path, reason),
      ),
      WorkflowPermanentFailureError: fromFields(
        { runId: "string", reason: "string" },
        (fields) => new WorkflowPermanentFailureError(fields),
      ),
      WorkflowRetryableError(record, recordMessage) {
        const details = record.details;

        return new WorkflowRetryableError(recordMessage, {
          details: sanitizedErrorDetails(details),
          retryAt: workflowErrorDetailTimestamp(details, "retryAt"),
          retryDelay: workflowErrorDetailDuration(details, "retryDelay"),
        });
      },
      WorkflowStepTimeoutError: fromFields(
        {
          runId: "string",
          stepId: "string",
          stepName: "string",
          attempt: "integer",
          timeoutAt: "instant",
        },
        (fields) => new WorkflowStepTimeoutError(fields),
      ),
      WorkflowResultTimeoutError: fromFields(
        { runId: "string", timeout: "duration" },
        ({ runId, timeout }) => new WorkflowResultTimeoutError(runId, timeout),
      ),
      WorkflowRunNotFoundError: fromFields(
        { runId: "string" },
        ({ runId }) => new WorkflowRunNotFoundError(runId),
      ),
      WorkflowRunCanceledError: fromFields(
        { runId: "string" },
        ({ runId }) => new WorkflowRunCanceledError(runId),
      ),
      WorkflowRunCancellationError: fromFields(
        { runId: "string", status: "terminalStatus" },
        ({ runId, status }) => new WorkflowRunCancellationError(runId, status),
      ),
      WorkflowRunDeadlineExceededError: fromFields(
        { runId: "string", deadlineAt: "instant" },
        ({ runId, deadlineAt }) => new WorkflowRunDeadlineExceededError(runId, deadlineAt),
      ),
      WorkflowRunParentError: fromFields(
        { runId: "string", reason: "string" },
        ({ runId, reason }) => new WorkflowRunParentError(runId, reason),
      ),
      WorkflowRunTransitionError: fromFields(
        { runId: "string", from: "runStatus", to: "runStatus" },
        ({ runId, from, to }) => new WorkflowRunTransitionError(runId, from, to),
      ),
      WorkflowMessageDeliveryError: fromFields(
        { runId: "string", status: "terminalStatus", messageId: "string" },
        (fields) => new WorkflowMessageDeliveryError(fields),
      ),
      WorkflowMessageIdempotencyConflictError: fromFields(
        { runId: "string", messageId: "string", idempotencyKey: "string" },
        (fields) => new WorkflowMessageIdempotencyConflictError(fields),
      ),
      WorkflowRunMismatchError: fromFields(
        { runId: "string", expectedWorkflowName: "string", actualWorkflowName: "string" },
        (fields) => new WorkflowRunMismatchError(fields),
      ),
      WorkflowChildWorkflowTimeoutError: fromFields(
        { runId: "string", childRunId: "string", stepId: "string", timeoutAt: "instant" },
        (fields) => new WorkflowChildWorkflowTimeoutError(fields),
      ),
      WorkflowMessageWaitTimeoutError: fromFields(
        {
          runId: "string",
          stepId: "string",
          stepName: "string",
          messageId: "string",
          timeoutAt: "instant",
        },
        (fields) => new WorkflowMessageWaitTimeoutError(fields),
      ),
      WorkflowHookDisposedError: fromFields(
        { runId: "string", stepId: "string", stepName: "string", messageId: "string" },
        (fields) => new WorkflowHookDisposedError(fields),
      ),
      WorkflowStepExecutionError: fromFields(
        { stepId: "string", stepName: "string", attempt: "integer" },
        (fields, recordMessage, details) =>
          new WorkflowStepExecutionError({
            ...fields,
            cause:
              details !== undefined && hasErrorCauseDetails(details)
                ? workflowErrorFromRecord(unprefixErrorCauseDetails(details))
                : new WorkflowError(recordMessage),
          }),
      ),
      WorkflowStepRetryLimitError: fromFields(
        { stepId: "string", stepName: "string", attempt: "integer" },
        (fields) => new WorkflowStepRetryLimitError(fields),
      ),
      WorkflowStepAttemptLimitError: fromFields(
        { runId: "string", maximumAttempts: "integer" },
        ({ runId, maximumAttempts }) => new WorkflowStepAttemptLimitError(runId, maximumAttempts),
      ),
      WorkflowReplayDivergenceError(record) {
        const details = record.details;

        if (record.message === undefined || record.message.trim() === "") {
          return undefined;
        }

        return new WorkflowReplayDivergenceError(
          record.message.replace(/^Workflow replay diverged: /, ""),
          {
            expectedStepId: workflowErrorDetailString(details, "expectedStepId"),
            actualStepId: workflowErrorDetailString(details, "actualStepId"),
          },
        );
      },
    } satisfies Record<string, ErrorRecordFactory>),
  );

  return recordFactories;
}

interface DomainErrorConstructor {
  new (message: string, code: WorkflowErrorCode, details?: ErrorDetails): WorkflowError;
}

function domainErrorFactory(ErrorConstructor: DomainErrorConstructor): ErrorRecordFactory {
  return (record, recordMessage) => {
    const code = ss.safeParseSync(errorCodeSchema, record.code);

    return code.success
      ? new ErrorConstructor(recordMessage, code.value, sanitizedErrorDetails(record.details))
      : undefined;
  };
}

interface DetailsErrorConstructor {
  new (message: string, options: WorkflowErrorOptions): WorkflowError;
}

function withDetails(ErrorConstructor: DetailsErrorConstructor): ErrorRecordFactory {
  return (record, recordMessage) =>
    new ErrorConstructor(recordMessage, { details: sanitizedErrorDetails(record.details) });
}

interface ErrorRecordView {
  readonly code: WorkflowErrorCode;
  readonly details?: ErrorDetails;
}

/** Safely exposes fields shared by live workflow errors and persisted workflow error records. */
function workflowErrorRecordView(cause: unknown): ErrorRecordView | undefined {
  if (!isObject(cause)) {
    return undefined;
  }

  const code = "code" in cause ? ss.safeParseSync(errorCodeSchema, cause.code) : undefined;

  if (code === undefined || !code.success) {
    return undefined;
  }

  if (!("details" in cause) || cause.details === undefined) {
    return { code: code.value };
  }

  const details = ss.safeParseSync(errorDetailsSchema, cause.details);

  return details.success ? { code: code.value, details: details.value } : undefined;
}

/**
 * Whether `cause` is a workflow error, or a record of one, with `code` and every given detail value.
 * Detail values left `undefined` match anything.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Callers pass caught values, which have no static type.
export function matchesWorkflowError(
  cause: unknown,
  code: WorkflowErrorCode,
  details: ErrorDetails = {},
): boolean {
  const record = workflowErrorRecordView(cause);

  return (
    record?.code === code &&
    Object.entries(details).every(
      ([key, value]) => value === undefined || record.details?.[key] === value,
    )
  );
}

function hasErrorCauseDetails(details: ErrorDetails): boolean {
  return (
    workflowErrorDetailString(details, "causeName") !== undefined ||
    workflowErrorDetailString(details, "causeMessage") !== undefined
  );
}

function unprefixErrorCauseDetails(details: ErrorDetails): WorkflowErrorRecord {
  const unprefixed = Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => /^cause[A-Z]/.test(key))
      .map(([key, value]) => {
        const unprefixedKey = key.slice("cause".length);

        return [`${unprefixedKey[0]?.toLowerCase() ?? ""}${unprefixedKey.slice(1)}`, value];
      }),
  );

  const name =
    isString(unprefixed.name) && unprefixed.name.trim() !== "" ? unprefixed.name : "WorkflowError";

  const message =
    isString(unprefixed.message) && unprefixed.message.trim() !== "" ? unprefixed.message : name;

  const stack =
    isString(unprefixed.stack) && unprefixed.stack.trim() !== "" ? unprefixed.stack : undefined;

  const code = ss.safeParseSync(errorCodeSchema, unprefixed.code);

  const publicDetails = Object.fromEntries(
    Object.entries(unprefixed).filter(
      ([key]) => key !== "code" && key !== "name" && key !== "message" && key !== "stack",
    ),
  );

  const sanitizedDetails = sanitizedErrorDetails(publicDetails);

  return {
    name,
    message,
    code: code.success ? code.value : undefined,
    stack,
    details: sanitizedDetails,
  };
}

function workflowErrorDetailString(
  details: ErrorDetails | undefined,
  key: string,
): string | undefined {
  const parsed = ss.safeParseSync(errorDetailsSchema, details);

  if (!parsed.success) {
    return undefined;
  }

  const result = ss.safeParseSync(optionalErrorStringSchema, parsed.value[key]);

  return result.success ? result.value : undefined;
}

function workflowErrorDetailPositiveSafeInteger(
  details: ErrorDetails | undefined,
  key: string,
): number | undefined {
  const parsed = ss.safeParseSync(errorDetailsSchema, details);

  if (!parsed.success) {
    return undefined;
  }

  const result = ss.safeParseSync(ss.optional(positiveSafeIntegerSchema), parsed.value[key]);

  return result.success ? result.value : undefined;
}

function workflowErrorRunStatusOrUndefined(
  value: ErrorDetails[string] | undefined,
): RunStatus | undefined {
  const result = ss.safeParseSync(errorRunStatusSchema, value);

  return result.success ? result.value : undefined;
}

function workflowTerminalErrorRunStatusOrUndefined(
  value: ErrorDetails[string] | undefined,
): TerminalRunStatus | undefined {
  const result = ss.safeParseSync(terminalErrorRunStatusSchema, value);

  return result.success ? result.value : undefined;
}

function workflowErrorDetailTimestamp(
  details: ErrorDetails | undefined,
  key: string,
): Temporal.Instant | undefined {
  return parseDetail(details, key, (value) => Temporal.Instant.from(value));
}

function workflowErrorDetailDuration(
  details: ErrorDetails | undefined,
  key: string,
): Temporal.Duration | undefined {
  return parseDetail(details, key, (value) => Temporal.Duration.from(value));
}

function parseDetail<T>(
  details: ErrorDetails | undefined,
  key: string,
  parse: (value: string) => T,
): T | undefined {
  const value = workflowErrorDetailString(details, key);

  if (value === undefined) {
    return undefined;
  }

  try {
    return parse(value);
  } catch {
    return undefined;
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error details may come from thrown values; this schema parser establishes the persisted detail contract.
export function sanitizedErrorDetails(details: unknown): ErrorDetails | undefined {
  const parsed = ss.safeParseSync(errorDetailsSchema, details);

  if (!parsed.success) {
    return undefined;
  }

  return Object.keys(parsed.value).length === 0 ? undefined : parsed.value;
}
