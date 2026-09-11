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
  const summary: CreateWorkflowWorkerOptions = { engine, registry, now };

  if (options?.workerId !== undefined) {
    Object.assign(summary, {
      workerId: options.workerId,
    } satisfies Partial<CreateWorkflowWorkerOptions>);
  }

  if (options?.leaseDuration !== undefined) {
    Object.assign(summary, {
      leaseDuration: options.leaseDuration,
    } satisfies Partial<CreateWorkflowWorkerOptions>);
  }

  if (options?.pollInterval !== undefined) {
    Object.assign(summary, {
      pollInterval: options.pollInterval,
    } satisfies Partial<CreateWorkflowWorkerOptions>);
  }

  if (options?.heartbeatInterval !== undefined) {
    Object.assign(summary, {
      heartbeatInterval: options.heartbeatInterval,
    } satisfies Partial<CreateWorkflowWorkerOptions>);
  }

  if (options?.stopDrainTimeout !== undefined) {
    Object.assign(summary, {
      stopDrainTimeout: options.stopDrainTimeout,
    } satisfies Partial<CreateWorkflowWorkerOptions>);
  }

  if (options?.missingImplementationRetry !== undefined) {
    Object.assign(summary, {
      missingImplementationRetry: options.missingImplementationRetry,
    } satisfies Partial<CreateWorkflowWorkerOptions>);
  }

  return summary;
}

export function workerOptionsFromWakeOptions(
  options: WorkflowWorkerFacetOptions | undefined,
): WorkflowClientWorkerOptions {
  const result1: WorkflowClientWorkerOptions = {};

  if (options?.workerId !== undefined) {
    Object.assign(result1, {
      workerId: options.workerId,
    } satisfies Partial<WorkflowClientWorkerOptions>);
  }

  if (options?.leaseDuration !== undefined) {
    Object.assign(result1, {
      leaseDuration: options.leaseDuration,
    } satisfies Partial<WorkflowClientWorkerOptions>);
  }

  if (options?.heartbeatInterval !== undefined) {
    Object.assign(result1, {
      heartbeatInterval: options.heartbeatInterval,
    } satisfies Partial<WorkflowClientWorkerOptions>);
  }

  if (options?.stopDrainTimeout !== undefined) {
    Object.assign(result1, {
      stopDrainTimeout: options.stopDrainTimeout,
    } satisfies Partial<WorkflowClientWorkerOptions>);
  }

  if (options?.missingImplementationRetry !== undefined) {
    Object.assign(result1, {
      missingImplementationRetry: options.missingImplementationRetry,
    } satisfies Partial<WorkflowClientWorkerOptions>);
  }

  return result1;
}
