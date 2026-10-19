/** Retry policy for workflow runs after retryable workflow failures. */
export interface RetryConfig {
  readonly maximumAttempts?: number;
  readonly initialInterval?: Temporal.Duration;
  readonly backoffCoefficient?: number;
  readonly maximumInterval?: Temporal.Duration;
}

/** Retry policy after duration values and defaults have been normalized. */
export interface ResolvedRetryConfig {
  readonly maximumAttempts: number;
  readonly initialInterval?: Temporal.Duration;
  readonly backoffCoefficient: number;
  readonly maximumInterval?: Temporal.Duration;
}

/** Resolved retry policy used after a worker cannot find a workflow implementation. */
export interface ResolvedMissingImplementationRetryConfig {
  readonly initialInterval: Temporal.Duration;
  readonly backoffCoefficient: number;
  readonly maximumInterval?: Temporal.Duration;
  readonly maximumAttempts: number;
}

/** Required default values used to complete missing-implementation retry options. */
export interface MissingImplementationRetryDefaults {
  readonly initialInterval: Temporal.Duration;
  readonly backoffCoefficient: number;
  readonly maximumAttempts: number;
}

/** Required default values used to complete workflow and step retry options. */
export interface ResolvedRetryDefaults {
  readonly maximumAttempts: number;
  readonly backoffCoefficient: number;
}

/** Retry policy used when a worker cannot find an implementation for a claimed run. */
export interface MissingImplementationRetryConfig {
  readonly initialInterval?: Temporal.Duration;
  readonly backoffCoefficient?: number;
  readonly maximumInterval?: Temporal.Duration;
  readonly maximumAttempts?: number;
}
