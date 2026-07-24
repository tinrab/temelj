import type { CreateWorkflowEngineOptions } from "../types/engine-options.ts";
import type { ObservationEmitter } from "../types/observation.ts";
import type { ExecutionResult } from "../types/result.ts";
import type {
  WorkflowLifecycleCallback,
  WorkflowLifecycleEvent,
  WorkflowRunRecord,
} from "../types/run.ts";

export function createWorkflowLifecycleEmitter(
  options: CreateWorkflowEngineOptions,
  observation?: ObservationEmitter,
): WorkflowLifecycleEmitterContract {
  return new WorkflowLifecycleEmitter(options, observation);
}

interface WorkflowLifecycleEmitterContract {
  readonly emitLifecycleEvent: (
    run: WorkflowRunRecord,
    previousRun?: WorkflowRunRecord,
  ) => Promise<void>;
  readonly emitResultLifecycleEvent: <TOutput>(
    result: ExecutionResult<TOutput>,
    previousRun?: WorkflowRunRecord,
  ) => Promise<ExecutionResult<TOutput>>;
}

export class WorkflowLifecycleEmitter implements WorkflowLifecycleEmitterContract {
  readonly #options: CreateWorkflowEngineOptions;
  readonly #observation?: ObservationEmitter;

  constructor(options: CreateWorkflowEngineOptions, observation?: ObservationEmitter) {
    this.#options = options;
    this.#observation = observation;
  }

  emitLifecycleEvent = async (
    run: WorkflowRunRecord,
    previousRun?: WorkflowRunRecord,
  ): Promise<void> => {
    const event: WorkflowLifecycleEvent = {
      run,
      previousRun,
      status: run.status,
      reason: run.lastTransitionReason,
      timestamp: run.lastTransitionAt,
      workflowName: run.workflowName,
      ...(run.workflowVersion === undefined ? {} : { workflowVersion: run.workflowVersion }),
    };
    this.#observation?.emitRunEvent(run, previousRun);
    const callbacks: WorkflowLifecycleCallback[] = [];
    if (this.#options.onLifecycleEvent !== undefined) {
      callbacks.push(this.#options.onLifecycleEvent);
    }
    if (run.status === "completed" && this.#options.onRunCompleted !== undefined) {
      callbacks.push(this.#options.onRunCompleted);
    } else if (run.status === "failed" && this.#options.onRunFailed !== undefined) {
      callbacks.push(this.#options.onRunFailed);
    } else if (run.status === "canceled" && this.#options.onRunCanceled !== undefined) {
      callbacks.push(this.#options.onRunCanceled);
    } else if (
      run.status === "waiting" &&
      run.lastTransitionReason === "retry" &&
      this.#options.onRunRetry !== undefined
    ) {
      callbacks.push(this.#options.onRunRetry);
    } else if (run.status === "waiting" && this.#options.onRunWaiting !== undefined) {
      callbacks.push(this.#options.onRunWaiting);
    }
    for (const callback of callbacks) {
      await callback(event);
    }
  };

  emitResultLifecycleEvent = async <TOutput>(
    result: ExecutionResult<TOutput>,
    previousRun?: WorkflowRunRecord,
  ): Promise<ExecutionResult<TOutput>> => {
    if (
      result.run.lastTransitionReason === "completed" ||
      result.run.lastTransitionReason === "failed" ||
      result.run.lastTransitionReason === "deadline" ||
      result.run.lastTransitionReason === "waiting" ||
      result.run.lastTransitionReason === "retry" ||
      result.run.lastTransitionReason === "canceled"
    ) {
      await this.emitLifecycleEvent(result.run as WorkflowRunRecord, previousRun);
    }
    return result;
  };
}
