import type {
  ChildWorkflowStartedEvent,
  DeterministicValueRecordedEvent,
  EventRecord,
  MessageSendStartedEvent,
  MessageWaitStartedEvent,
  MetadataSetEvent,
  SleepStartedEvent,
  WorkflowStepStartedEvent,
  StreamStartedEvent,
} from "../types/events.ts";
import type { WorkflowStepIdentity, WorkflowStepType } from "../types/run.ts";

import { WorkflowReplayDivergenceError, WorkflowStateError } from "../errors/mod.ts";
import { getEventDescriptor, isWorkflowRecordedStepEventKind } from "../events/descriptors.ts";

export type WorkflowRecordedStepEvent =
  | WorkflowStepStartedEvent
  | SleepStartedEvent
  | ChildWorkflowStartedEvent
  | MessageSendStartedEvent
  | MessageWaitStartedEvent
  | StreamStartedEvent
  | DeterministicValueRecordedEvent
  | MetadataSetEvent;

export function createWorkflowStepSequencer(events: readonly EventRecord[]): WorkflowStepSequencer {
  return new WorkflowStepSequencer(distinctRecordedStepEvents(events));
}

export class WorkflowStepSequencer {
  readonly #counts = new Map<string, number>();
  readonly #recordedSteps: readonly WorkflowRecordedStepEvent[];
  #cursor = 0;

  constructor(recordedSteps: readonly WorkflowRecordedStepEvent[]) {
    this.#recordedSteps = recordedSteps;
  }

  next<TType extends WorkflowStepType>(type: TType, name: string): WorkflowStepIdentity<TType> {
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

  #requireNextRecordedStepMatches(identity: WorkflowStepIdentity): void {
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

export function workflowRecordedStepEventType(event: WorkflowRecordedStepEvent): WorkflowStepType {
  const stepType = getEventDescriptor(event.kind).stepType;
  if (stepType === undefined) {
    WorkflowStateError.unsupportedRecordedStepEventType(event.kind);
  }
  return stepType;
}

export function isWorkflowRecordedStepEvent(
  event: EventRecord,
): event is WorkflowRecordedStepEvent {
  return (
    isWorkflowRecordedStepEventKind(event.kind) &&
    "stepId" in event &&
    "stepName" in event &&
    "count" in event
  );
}

function distinctRecordedStepEvents(
  events: readonly EventRecord[],
): readonly WorkflowRecordedStepEvent[] {
  const recorded: WorkflowRecordedStepEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (!isWorkflowRecordedStepEvent(event)) {
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
