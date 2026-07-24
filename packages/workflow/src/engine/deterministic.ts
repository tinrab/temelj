import type { WorkflowExecutionEnvironment } from "../types/engine.ts";
import type { StepId, WorkflowDeterministicApi, WorkflowStepMetadata } from "../types/step.ts";

import { WorkflowOptionsError, WorkflowReplayDivergenceError } from "../errors/mod.ts";
import { isNonNegativeSafeInteger } from "../utility.ts";
import { resolveWorkflowCommandIdentity } from "./command-identity.ts";
import { toPersistedValue } from "./serialization.ts";
import { appendEventIfCurrentExecution } from "./state.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createWorkflowDeterministicApi(
  environment: WorkflowExecutionEnvironment,
): WorkflowDeterministicApi {
  const { now, runId } = environment;
  const api: WorkflowDeterministicApi = {
    async now(commandId = "now") {
      return await recordWorkflowDeterministicValue(environment, commandId, () => now());
    },

    async random(commandId = "random") {
      return await recordWorkflowDeterministicValue(
        environment,
        commandId,
        (identity) => {
          const value = environment.createDeterministicRandom(
            deterministicValueContext(runId, identity),
          );
          if (!isDeterministicRandomValue(value)) {
            invalidDeterministicValue(identity.id, "a finite number in [0, 1)");
          }
          return value;
        },
        (recorded) => {
          if (!isDeterministicRandomValue(recorded.value)) {
            invalidDeterministicValue(recorded.stepId, "a finite number in [0, 1)");
          }
        },
      );
    },

    async recordedId(commandId = "recorded-id") {
      return await recordWorkflowDeterministicValue(environment, commandId, (identity) =>
        environment.createRecordedId(deterministicValueContext(runId, identity)),
      );
    },

    async id(commandId = "id") {
      return await api.recordedId(commandId);
    },

    async uuid(commandId = "uuid") {
      return await recordWorkflowDeterministicValue(
        environment,
        commandId,
        (identity) => {
          const value = environment.createDeterministicUuid(
            deterministicValueContext(runId, identity),
          );
          if (!isDeterministicUuidValue(value)) {
            invalidDeterministicValue(identity.id, "a UUID string");
          }
          return value;
        },
        (recorded) => {
          if (!isDeterministicUuidValue(recorded.value)) {
            invalidDeterministicValue(recorded.stepId, "a UUID string");
          }
        },
      );
    },

    async bytes(commandId, length) {
      if (typeof commandId !== "string") {
        WorkflowOptionsError.string("Workflow deterministic bytes commandId");
      }
      if (commandId.trim() === "") {
        WorkflowOptionsError.nonBlank("Workflow deterministic bytes commandId");
      }
      if (!isNonNegativeSafeInteger(length)) {
        WorkflowOptionsError.nonNegativeSafeInteger("Workflow deterministic bytes length");
      }
      const bytes = await recordWorkflowDeterministicValue(
        environment,
        commandId,
        (identity) => {
          const value = environment.createDeterministicBytes({
            ...deterministicValueContext(runId, identity),
            length,
          });
          if (!isDeterministicBytesValue(value, length)) {
            invalidDeterministicValue(identity.id, `a Uint8Array with length ${length}`);
          }
          return new Uint8Array(value);
        },
        (recorded) => {
          if (!isDeterministicBytesValue(recorded.value, length)) {
            invalidDeterministicValue(recorded.stepId, `a Uint8Array with length ${length}`);
          }
        },
      );
      return new Uint8Array(bytes);
    },
  };
  return api;
}

export async function recordWorkflowDeterministicValue<TValue>(
  environment: WorkflowExecutionEnvironment,
  name: string,
  createValue: (identity: WorkflowStepMetadata) => TValue,
  checkRecorded?: (recorded: {
    readonly stepId: StepId;
    readonly timestamp: Temporal.Instant;
    readonly value: unknown;
  }) => void,
): Promise<TValue> {
  const { store, history, now, limits, executionOwner, runId } = environment;
  const identity = resolveWorkflowCommandIdentity(history, "deterministic", name);
  const recorded = history.deterministicValue(identity.id);
  if (recorded !== undefined) {
    checkRecorded?.(recorded);
    return recorded.value as TValue;
  }
  const value = createValue(identity);
  await appendEventIfCurrentExecution(
    store,
    history,
    {
      kind: "deterministic_value_recorded",
      timestamp: now(),
      stepId: identity.id,
      stepName: identity.name,
      count: identity.count,
      value: toPersistedValue(value, "deterministic value", limits),
    },
    executionOwner,
    limits,
    undefined,
    (event, events) => environment.observeDurableEventAppended?.(runId, event, events),
  );
  return value;
}

function deterministicValueContext(runId: string, identity: WorkflowStepMetadata) {
  return {
    runId,
    commandId: identity.id,
    commandName: identity.name,
    commandCount: identity.count,
  };
}

function isDeterministicRandomValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1;
}

function isDeterministicUuidValue(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isDeterministicBytesValue(value: unknown, length: number): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === length;
}

function invalidDeterministicValue(stepId: StepId, expected: string): never {
  WorkflowReplayDivergenceError.diverged(
    `recorded deterministic value for ${stepId} must be ${expected}`,
    {
      expectedStepId: stepId,
      actualStepId: stepId,
    },
  );
}
