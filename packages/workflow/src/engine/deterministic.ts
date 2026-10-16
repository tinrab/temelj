import { isNumber, isString } from "@temelj/value";

import type { RecordedIdContext } from "../types/engine-options.ts";
import type { ExecutionEnvironment } from "../types/engine.ts";
import type { DeterministicValueRecordedEvent } from "../types/events.ts";
import type { StepId } from "../types/ids.ts";
import type { DeterministicApi, StepMetadata } from "../types/step.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowOptionsError, WorkflowReplayDivergenceError } from "../errors/mod.ts";
import { isNonNegativeSafeInteger } from "../values.ts";
import { resolveCommandIdentity } from "./command-identity.ts";
import { appendDurableEvent } from "./durable-command.ts";
import { toPersistedValue } from "./serialization.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createDeterministicApi(environment: ExecutionEnvironment): DeterministicApi {
  const { runId } = environment;

  /** Records a generated value, checking it both when it is created and when it is replayed. */
  const checked = async <TValue>(
    commandId: string,
    expected: string,
    isValid: (value: unknown) => value is TValue,
    create: (context: RecordedIdContext) => TValue,
  ): Promise<TValue> =>
    await recordDeterministicValue(
      environment,
      commandId,
      (identity) => {
        const value = create({
          runId,
          commandId: identity.id,
          commandName: identity.name,
          commandCount: identity.count,
        });

        if (!isValid(value)) {
          invalidDeterministicValue(identity.id, expected);
        }

        return value;
      },
      (recorded) => {
        if (!isValid(recorded.value)) {
          invalidDeterministicValue(recorded.stepId, expected);
        }

        return recorded.value;
      },
    );

  const api: DeterministicApi = {
    now: async (commandId = "now") =>
      await checked(commandId, "a Temporal.Instant", isInstant, () => environment.now()),
    random: async (commandId = "random") =>
      await checked(
        commandId,
        "a finite number in [0, 1)",
        isDeterministicRandomValue,
        environment.createDeterministicRandom,
      ),
    recordedId: async (commandId = "recorded-id") =>
      await checked(commandId, "a recorded ID string", isString, environment.createRecordedId),
    id: async (commandId = "id") => await api.recordedId(commandId),
    uuid: async (commandId = "uuid") =>
      await checked(
        commandId,
        "a UUID string",
        isDeterministicUuidValue,
        environment.createDeterministicUuid,
      ),

    async bytes(commandId, length) {
      if (commandId.trim() === "") {
        throw new WorkflowOptionsError("Workflow deterministic bytes commandId must not be blank", {
          code: WorkflowErrorCode.OPTIONS_EXPECTED_NON_BLANK,
          details: { label: "Workflow deterministic bytes commandId" },
        });
      }

      if (!isNonNegativeSafeInteger(length)) {
        WorkflowOptionsError.nonNegativeSafeInteger("Workflow deterministic bytes length");
      }

      const bytes = await checked(
        commandId,
        `a Uint8Array with length ${length}`,
        (value): value is Uint8Array => isDeterministicBytesValue(value, length),
        (context) => environment.createDeterministicBytes({ ...context, length }),
      );

      return new Uint8Array(bytes);
    },
  };

  return api;
}

function isInstant(value: unknown): value is Temporal.Instant {
  return value instanceof Temporal.Instant;
}

export async function recordDeterministicValue<TValue>(
  environment: ExecutionEnvironment,
  name: string,
  createValue: (identity: StepMetadata) => TValue,
  readRecorded: (recorded: DeterministicValueRecordedEvent) => NoInfer<TValue>,
): Promise<TValue> {
  const { history, now, limits } = environment;
  const identity = resolveCommandIdentity(history, "deterministic", name);
  const recorded = history.deterministicValue(identity.id);

  if (recorded !== undefined) {
    return readRecorded(recorded);
  }

  const value = createValue(identity);
  await appendDurableEvent(environment, {
    kind: "deterministic_value_recorded",
    timestamp: now(),
    stepId: identity.id,
    stepName: identity.name,
    count: identity.count,
    value: toPersistedValue(value, "deterministic value", limits),
  });

  return value;
}

function isDeterministicRandomValue(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value) && value >= 0 && value < 1;
}

function isDeterministicUuidValue(value: unknown): value is string {
  return isString(value) && UUID_PATTERN.test(value);
}

function isDeterministicBytesValue(value: unknown, length: number): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === length;
}

function invalidDeterministicValue(stepId: StepId, expected: string): never {
  WorkflowReplayDivergenceError.atStep(
    stepId,
    `recorded deterministic value for ${stepId} must be ${expected}`,
  );
}
