import type { WorkflowEngine } from "../engine/create.ts";
import type { ClientWorkerOptions } from "../types/client.ts";
import type { RegistryLike } from "../types/definition.ts";
import type { MissingImplementationRetryConfig } from "../types/retry.ts";
import type { CreateWorkflowWorkerOptions } from "../types/worker.ts";

interface WorkerFacetOptions {
  readonly workerId?: string;
  readonly leaseDuration?: Temporal.Duration;
  readonly heartbeatInterval?: Temporal.Duration;
  readonly stopDrainTimeout?: Temporal.Duration;
  readonly missingImplementationRetry?: MissingImplementationRetryConfig;
}

export function workerOptionsFromClientOptions(
  engine: WorkflowEngine,
  registry: RegistryLike,
  now: () => Temporal.Instant,
  options: ClientWorkerOptions | undefined,
): CreateWorkflowWorkerOptions {
  return {
    engine,
    registry,
    now,
    workerId: options?.workerId,
    leaseDuration: options?.leaseDuration,
    pollInterval: options?.pollInterval,
    heartbeatInterval: options?.heartbeatInterval,
    stopDrainTimeout: options?.stopDrainTimeout,
    missingImplementationRetry: options?.missingImplementationRetry,
  };
}

export function workerOptionsFromWakeOptions(
  options: WorkerFacetOptions | undefined,
): ClientWorkerOptions {
  return {
    workerId: options?.workerId,
    leaseDuration: options?.leaseDuration,
    heartbeatInterval: options?.heartbeatInterval,
    stopDrainTimeout: options?.stopDrainTimeout,
    missingImplementationRetry: options?.missingImplementationRetry,
  };
}
