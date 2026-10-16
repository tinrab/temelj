import type {
  ChildWorkflowStartedEvent,
  DeterministicValueRecordedEvent,
  EventRecord,
  MessageSendStartedEvent,
  MessageWaitStartedEvent,
  MetadataSetEvent,
  SleepStartedEvent,
  StepStartedEvent,
  StreamStartedEvent,
} from "../types/events.ts";
import type { StepIdentity, StepType } from "../types/run.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowReplayDivergenceError, WorkflowStateError } from "../errors/mod.ts";
import { getEventDescriptor, isWorkflowRecordedStepEventKind } from "../events/descriptors.ts";

export type RecordedStepEvent =
  | StepStartedEvent
  | SleepStartedEvent
  | ChildWorkflowStartedEvent
  | MessageSendStartedEvent
  | MessageWaitStartedEvent
  | StreamStartedEvent
  | DeterministicValueRecordedEvent
  | MetadataSetEvent;

export function createStepSequencer(events: readonly EventRecord[]): StepSequencer {
  return new StepSequencer(distinctRecordedStepEvents(events));
}

export class StepSequencer {
  readonly #counts = new Map<string, number>();
  readonly #recordedSteps: readonly RecordedStepEvent[];
  #cursor = 0;

  constructor(recordedSteps: readonly RecordedStepEvent[]) {
    this.#recordedSteps = recordedSteps;
  }

  next<TType extends StepType>(type: TType, name: string): StepIdentity<TType> {
    const key = `${type}:${name}`;
    const count = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, count);

    const identity = {
      id: count === 1 ? `${type}:${name}` : `${type}:${name}:${count - 1}`,
      name,
      count,
      kind: type,
    };

    this.#requireNextRecordedStepMatches(identity);
    this.#cursor++;

    return identity;
  }

  requireConsumed(): void {
    const recorded = this.#recordedSteps[this.#cursor];

    if (recorded === undefined) {
      return;
    }

    WorkflowReplayDivergenceError.diverged(
      `recorded step ${recorded.stepId} was not encountered by the workflow handler`,
      {
        expectedStepId: recorded.stepId,
      },
    );
  }

  isConsumed(): boolean {
    return this.#recordedSteps[this.#cursor] === undefined;
  }

  #requireNextRecordedStepMatches(identity: StepIdentity): void {
    const recorded = this.#recordedSteps[this.#cursor];

    if (recorded === undefined) {
      return;
    }

    const recordedType = workflowRecordedStepEventType(recorded);

    if (!(recorded.timestamp instanceof Temporal.Instant)) {
      WorkflowReplayDivergenceError.diverged(
        `recorded ${recordedType} step ${recorded.stepId} has invalid start timestamp: ${String(recorded.timestamp)}`,
        {
          expectedStepId: recorded.stepId,
          actualStepId: identity.id,
        },
      );
    }

    if (!(Number.isSafeInteger(recorded.count) && recorded.count > 0)) {
      WorkflowReplayDivergenceError.diverged(
        `recorded ${recordedType} step ${recorded.stepId} has an invalid count`,
        {
          expectedStepId: recorded.stepId,
          actualStepId: identity.id,
        },
      );
    }

    if (
      recordedType === identity.kind &&
      recorded.stepId === identity.id &&
      recorded.stepName === identity.name &&
      recorded.count === identity.count
    ) {
      return;
    }

    WorkflowReplayDivergenceError.diverged(
      `expected recorded ${recordedType} step ${recorded.stepId}, but encountered ${identity.kind} step ${identity.id}`,
      {
        expectedStepId: recorded.stepId,
        actualStepId: identity.id,
      },
    );
  }
}

export function workflowRecordedStepEventType(event: RecordedStepEvent): StepType {
  const stepType = getEventDescriptor(event.kind).stepType;

  if (stepType === undefined) {
    throw new WorkflowStateError(
      `Workflow recorded step event type is not supported: ${event.kind}`,
      {
        code: WorkflowErrorCode.STATE_RECORDED_STEP_EVENT_UNSUPPORTED,
        details: { kind: event.kind },
      },
    );
  }

  return stepType;
}

export function isRecordedStepEvent(event: EventRecord): event is RecordedStepEvent {
  return (
    isWorkflowRecordedStepEventKind(event.kind) &&
    "stepId" in event &&
    "stepName" in event &&
    "count" in event
  );
}

function distinctRecordedStepEvents(events: readonly EventRecord[]): readonly RecordedStepEvent[] {
  const recorded: RecordedStepEvent[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (!isRecordedStepEvent(event)) {
      continue;
    }

    const key = `${event.kind}:${event.stepId}:${event.count}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    recorded.push(event);
  }

  return recorded;
}
