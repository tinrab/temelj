import type {
  WorkflowCleanupAdmin,
  WorkflowHookManager,
  LockManager,
  WorkflowMessageSender,
  WorkflowRunMaintenance,
  WorkflowRunReader,
  WorkflowRunRerunner,
  WorkflowScheduler,
  WorkflowStarter,
  WorkflowStepAttemptReader,
  WorkflowStreamReader,
} from "../../src/types/engine.ts";

export type WorkflowClientTestRuntimeEngine = WorkflowStarter &
  WorkflowScheduler &
  LockManager &
  WorkflowRunReader &
  WorkflowStepAttemptReader &
  WorkflowRunMaintenance &
  WorkflowCleanupAdmin &
  WorkflowRunRerunner &
  WorkflowHookManager &
  WorkflowStreamReader &
  WorkflowMessageSender & {
    close?(): Promise<void>;
  };

export function withoutWorkflowWorkerStore(
  engine: WorkflowClientTestRuntimeEngine,
): WorkflowClientTestRuntimeEngine {
  return new Proxy(engine, {
    get: (target, property, receiver) =>
      property === "store" ? undefined : Reflect.get(target, property, receiver),
  });
}
