/**
 * Standard options accepted by most async operations.
 */
export interface StandardOptions {
  /** The signal to abort the operation. */
  signal?: AbortSignal;
}

/**
 * Options for controlling concurrency of async operations.
 */
export interface ConcurrencyOptions extends StandardOptions {
  /** Max number of concurrent operations. Default: Infinity. */
  concurrency?: number;
}

/**
 * Options for controlling resilience behavior of async operations.
 */
export interface ResilienceOptions extends StandardOptions {
  /** If true, the operation fails immediately on the first error. Default: true. */
  stopOnError?: boolean;
}

/**
 * A unique symbol used to skip items during iteration without throwing errors.
 *
 * Return `Skip` from a mapper to omit the value from the result.
 */
export const Skip: unique symbol = Symbol("AsyncFlow.Skip");

/**
 * The type of the {@link Skip} symbol.
 */
export type SkipSymbol = typeof Skip;
