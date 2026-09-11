import type { StorageValue } from "@temelj/storage";

import { validateStandardSchema } from "@temelj/standard-schema";
import { createSuperJsonStorageCodec } from "@temelj/storage";
import { isString } from "@temelj/value";

import type { WorkflowDefinition } from "../types/definition.ts";
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

export function serializeError(cause: unknown): WorkflowErrorRecord {
  if (cause instanceof Error) {
    const name = isString(cause.name) && cause.name.trim() !== "" ? cause.name : "Error";

    const message = isString(cause.message) && cause.message.trim() !== "" ? cause.message : name;

    const stack = isString(cause.stack) && cause.stack.trim() !== "" ? cause.stack : undefined;

    const record: WorkflowErrorRecord = { name, message, ...workflowErrorDetails(cause) };

    if (cause instanceof WorkflowError) Object.assign(record, { code: cause.code });

    if (stack !== undefined) Object.assign(record, { stack });

    return record;
  }

  const message = String(cause).trim() === "" ? "Error" : String(cause);

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

  const identity = { ...details, name: record.name, message: record.message };

  if (record.code !== undefined) Object.assign(identity, { code: record.code });

  if (record.stack !== undefined) Object.assign(identity, { stack: record.stack });

  return prefixWorkflowErrorCauseDetails(identity);
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

/** Validates workflow input and returns the value admitted to durable storage. */
export async function parseWorkflowInput(
  definition: WorkflowDefinition,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw workflow input enters through the definition schema and persistence validator.
  input: unknown,
): Promise<StorageValue | undefined> {
  const schema = definition.config.schema;

  const parsed =
    schema === undefined
      ? input
      : await validateStandardSchema(schema, input, "Workflow input validation failed");

  return toOptionalPersistedValue(parsed, "workflow input");
}

export function toPersistedValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the validation boundary for caller-defined workflow values before durable writes.
  value: unknown,
  path: string,
  limits?: WorkflowEngineSerializationLimits,
): StorageValue {
  const issue = persistedValueIssue(value, path, new WeakSet<object>(), false);

  if (issue !== undefined) {
    WorkflowSerializationError.notSerializable(issue.path, issue.message);
  }

  // SAFETY: persistedValueIssue recursively validated every supported value and rejected unsupported types and cycles.
  const persisted = value as StorageValue;
  enforceStorageValueSize(persisted, path, limits);

  return persisted;
}

export function toOptionalPersistedValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Optional caller values enter the same persistence validation boundary.
  value: unknown,
  path: string,
  limits?: WorkflowEngineSerializationLimits,
): StorageValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  return toPersistedValue(value, path, limits);
}

export function enforceStorageValueSize(
  value: StorageValue | undefined,
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

function persistedValueByteLength(value: StorageValue, path: string): number {
  try {
    return PERSISTED_VALUE_CODEC.encode(value).byteLength;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    WorkflowSerializationError.notSerializable(path, reason);
  }
}
