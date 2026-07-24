import type { StorageValue } from "@temelj/storage";

import { createSuperJsonStorageCodec } from "@temelj/storage";

import type { WorkflowEngineSerializationLimits } from "../types/engine-options.ts";
import type { WorkflowErrorDetails, WorkflowErrorRecord } from "../types/error.ts";

import {
  WorkflowError,
  WorkflowSerializationError,
  WorkflowStepExecutionError,
} from "../errors/mod.ts";
import { sanitizedWorkflowErrorDetails } from "../types/error.ts";
import { persistedValueIssue } from "../types/run.ts";

const PERSISTED_VALUE_CODEC = createSuperJsonStorageCodec<StorageValue, "bytes">({
  format: "bytes",
});

export function serializeError(error: unknown): WorkflowErrorRecord {
  if (error instanceof Error) {
    const name = typeof error.name === "string" && error.name.trim() !== "" ? error.name : "Error";
    const message =
      typeof error.message === "string" && error.message.trim() !== "" ? error.message : name;
    const stack =
      typeof error.stack === "string" && error.stack.trim() !== "" ? error.stack : undefined;
    return {
      ...(error instanceof WorkflowError ? { code: error.code } : {}),
      name,
      message,
      ...(stack === undefined ? {} : { stack }),
      ...workflowErrorDetails(error),
    };
  }
  const message = String(error).trim() === "" ? "Error" : String(error);
  return {
    name: "Error",
    message,
  };
}

interface WorkflowSerializedErrorDetails {
  readonly details?: WorkflowErrorDetails;
}

function workflowErrorDetails(error: Error): WorkflowSerializedErrorDetails {
  if (error instanceof WorkflowStepExecutionError) {
    const details = sanitizedWorkflowErrorDetails(error.details);
    return {
      details: {
        ...details,
        ...workflowErrorCauseDetails(error.cause),
      },
    };
  }
  if (error instanceof WorkflowError && error.details !== undefined) {
    const details = sanitizedWorkflowErrorDetails(error.details);
    return details === undefined ? {} : { details };
  }
  return {};
}

function workflowErrorCauseDetails(cause: unknown): WorkflowErrorDetails {
  if (!(cause instanceof Error)) {
    return {};
  }
  const record = serializeError(cause);
  const details = causeDetailsWithoutReservedIdentity(record.details);
  return prefixWorkflowErrorCauseDetails({
    ...details,
    ...(record.code === undefined ? {} : { code: record.code }),
    name: record.name,
    message: record.message,
    ...(record.stack === undefined ? {} : { stack: record.stack }),
  });
}

function causeDetailsWithoutReservedIdentity(
  details: WorkflowErrorDetails | undefined,
): WorkflowErrorDetails {
  if (details === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(details).filter(([key]) => {
      const prefixedKey = key.startsWith("cause")
        ? key
        : `cause${key[0]?.toUpperCase() ?? ""}${key.slice(1)}`;
      return (
        prefixedKey !== "causeName" &&
        prefixedKey !== "causeMessage" &&
        prefixedKey !== "causeStack"
      );
    }),
  );
}

function prefixWorkflowErrorCauseDetails(details: WorkflowErrorDetails): WorkflowErrorDetails {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key.startsWith("cause") ? key : `cause${key[0]?.toUpperCase() ?? ""}${key.slice(1)}`,
      value,
    ]),
  );
}

export function toPersistedValue(
  value: unknown,
  path: string,
  limits?: WorkflowEngineSerializationLimits,
): StorageValue {
  const issue = persistedValueIssue(value, path, new WeakSet<object>(), false);
  if (issue !== undefined) {
    WorkflowSerializationError.notSerializable(issue.path, issue.message);
  }
  enforceStorageValueSize(value, path, limits);
  return value as StorageValue;
}

export function toOptionalPersistedValue(
  value: unknown,
  path: string,
  limits?: WorkflowEngineSerializationLimits,
): StorageValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return toPersistedValue(value, path, limits);
}

function enforceStorageValueSize(
  value: unknown,
  path: string,
  limits: WorkflowEngineSerializationLimits | undefined,
): void {
  if (limits?.maximumPersistedValueBytes === undefined) {
    return;
  }
  if (value === undefined) {
    return;
  }
  const bytes = persistedValueByteLength(value, path);
  if (bytes > limits.maximumPersistedValueBytes) {
    WorkflowSerializationError.notSerializable(
      path,
      `serialized size ${bytes} bytes exceeds maximumPersistedValueBytes ${limits.maximumPersistedValueBytes}`,
    );
  }
}

function persistedValueByteLength(value: unknown, path: string): number {
  try {
    return PERSISTED_VALUE_CODEC.encode(value as StorageValue).byteLength;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    WorkflowSerializationError.notSerializable(path, reason);
  }
}
