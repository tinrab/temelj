import type { WorkflowClientWorkerOptions } from "../types/client.ts";
import type { RegistryLike } from "../types/definition.ts";
import type { WorkflowWorkerEngine } from "../types/engine.ts";
import type { WorkflowMissingImplementationRetryConfig } from "../types/retry.ts";
import type { CreateWorkflowWorkerOptions } from "../types/worker.ts";

interface WorkflowWorkerFacetOptions {
  readonly workerId?: string;
  readonly leaseDuration?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly stopDrainTimeout?: Temporal.Duration;
  readonly missingImplementationRetry?: WorkflowMissingImplementationRetryConfig;
}

export function workerOptionsFromClientOptions(
  engine: WorkflowWorkerEngine,
  registry: RegistryLike,
  now: () => Temporal.Instant,
  options: WorkflowClientWorkerOptions | undefined,
): CreateWorkflowWorkerOptions {
  return {
    engine,
    registry,
    now,
    ...(options?.workerId === undefined ? {} : { workerId: options.workerId }),
    ...(options?.leaseDuration === undefined ? {} : { leaseDuration: options.leaseDuration }),
    ...(options?.pollInterval === undefined ? {} : { pollInterval: options.pollInterval }),
    ...(options?.heartbeatInterval === undefined
      ? {}
      : { heartbeatInterval: options.heartbeatInterval }),
    ...(options?.stopDrainTimeout === undefined
      ? {}
      : { stopDrainTimeout: options.stopDrainTimeout }),
    ...(options?.missingImplementationRetry === undefined
      ? {}
      : { missingImplementationRetry: options.missingImplementationRetry }),
  };
}

export function workerOptionsFromWakeOptions(
  options: WorkflowWorkerFacetOptions | undefined,
): WorkflowClientWorkerOptions {
  return {
    ...(options?.workerId === undefined ? {} : { workerId: options.workerId }),
    ...(options?.leaseDuration === undefined ? {} : { leaseDuration: options.leaseDuration }),
    ...(options?.heartbeatInterval === undefined
      ? {}
      : { heartbeatInterval: options.heartbeatInterval }),
    ...(options?.stopDrainTimeout === undefined
      ? {}
      : { stopDrainTimeout: options.stopDrainTimeout }),
    ...(options?.missingImplementationRetry === undefined
      ? {}
      : { missingImplementationRetry: options.missingImplementationRetry }),
  };
}
