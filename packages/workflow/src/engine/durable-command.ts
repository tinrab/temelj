import type { WorkflowExecutionEnvironment } from "../types/engine.ts";
import type { EventRecord } from "../types/events.ts";

import { enforceStepAttemptBudget } from "./retry.ts";
import { appendEventIfCurrentExecution } from "./state.ts";

type WorkflowDurableStepStartedEvent = Extract<
  EventRecord,
  {
    readonly kind:
      | "step_started"
      | "sleep_started"
      | "child_workflow_started"
      | "message_send_started"
      | "message_wait_started"
      | "stream_started";
  }
>;

export async function appendDurableStepStartedEvent(
  environment: WorkflowExecutionEnvironment,
  event: WorkflowDurableStepStartedEvent,
): Promise<void> {
  await appendDurableStepEvent(environment, event, {
    enforceAttemptBudget: true,
  });
}

export async function appendDurableStepTerminalEvent(
  environment: WorkflowExecutionEnvironment,
  event: EventRecord,
): Promise<void> {
  await appendDurableStepEvent(environment, event);
}

interface AppendDurableStepEventOptions {
  readonly enforceAttemptBudget?: boolean;
}

async function appendDurableStepEvent(
  environment: WorkflowExecutionEnvironment,
  event: EventRecord,
  options: AppendDurableStepEventOptions = {},
): Promise<void> {
  const { store, runId, history, executionOwner, limits } = environment;
  await appendEventIfCurrentExecution(
    store,
    history,
    event,
    executionOwner,
    limits,
    options.enforceAttemptBudget === true
      ? () => {
          enforceStepAttemptBudget(runId, history, environment.maximumStepAttemptsPerRun);
        }
      : undefined,
    (appendedEvent, events) =>
      environment.observeDurableEventAppended?.(runId, appendedEvent, events),
  );
}
