/** Retry policy for workflow runs after retryable workflow failures. */
export interface WorkflowRetryConfig {
  readonly maximumAttempts?: number;
  readonly initialInterval?: Temporal.Duration;
  readonly backoffCoefficient?: number;
  readonly maximumInterval?: Temporal.Duration;
}

/** Retry policy after duration values and defaults have been normalized. */
export interface WorkflowResolvedRetryConfig {
  readonly maximumAttempts: number;
  readonly initialInterval?: Temporal.Duration;
  readonly backoffCoefficient: number;
  readonly maximumInterval?: Temporal.Duration;
}

/** Retry policy for durable task attempts. */
export type WorkflowStepRetryConfig = WorkflowRetryConfig;

/** Step retry policy after duration values and defaults have been normalized. */
export type WorkflowResolvedStepRetryConfig = WorkflowResolvedRetryConfig;

/** Resolved retry policy used after a worker cannot find a workflow implementation. */
export interface WorkflowResolvedMissingImplementationRetryConfig {
  readonly initialInterval: Temporal.Duration;
  readonly backoffCoefficient: number;
  readonly maximumInterval?: Temporal.Duration;
  readonly maximumAttempts: number;
}

/** Required default values used to complete missing-implementation retry options. */
export interface WorkflowMissingImplementationRetryDefaults {
  readonly initialInterval: Temporal.Duration;
  readonly backoffCoefficient: number;
  readonly maximumAttempts: number;
}

/** Required default values used to complete workflow and step retry options. */
export interface WorkflowResolvedRetryDefaults {
  readonly maximumAttempts: number;
  readonly backoffCoefficient: number;
}

/** Parsed retry policy before runtime defaults are applied. */
export type WorkflowParsedRetryConfig = WorkflowRetryConfig;

/** Retry policy used when a worker cannot find an implementation for a claimed run. */
export interface WorkflowMissingImplementationRetryConfig {
  readonly initialInterval?: Temporal.Duration;
  readonly backoffCoefficient?: number;
  readonly maximumInterval?: Temporal.Duration;
  readonly maximumAttempts?: number;
}
