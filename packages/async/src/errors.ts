/**
 * Error thrown when an operation is aborted via an {@link AbortSignal}.
 */
export class AbortError extends Error {
  constructor(message = "The operation was aborted") {
    super(message);
    this.name = "AbortError";
  }
}

/**
 * Error thrown when an operation exceeds its allowed time limit.
 */
export class TimeoutError extends Error {
  constructor(message = "The operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}
