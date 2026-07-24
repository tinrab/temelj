/**
 * Error thrown when an operation is aborted via an {@link AbortSignal}.
 */
export class AbortError extends Error {
  constructor(message = "The operation was aborted", context?: Function) {
    super(message);
    this.name = "AbortError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static aborted(this: void): never {
    throw AbortError.create(AbortError.aborted);
  }

  static create(this: void, context?: Function): AbortError {
    return new AbortError("The operation was aborted", context ?? AbortError.create);
  }
}

/**
 * Error thrown when an operation exceeds its allowed time limit.
 */
export class TimeoutError extends Error {
  constructor(message = "The operation timed out", context?: Function) {
    super(message);
    this.name = "TimeoutError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static timedOut(this: void, message?: string): never {
    throw TimeoutError.create(message, TimeoutError.timedOut);
  }

  static create(this: void, message?: string, context?: Function): TimeoutError {
    return new TimeoutError(message, context ?? TimeoutError.create);
  }
}

export class AsyncOptionsError extends RangeError {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "AsyncOptionsError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static barrierCapacity(this: void): never {
    throw new AsyncOptionsError(
      "Barrier capacity must be at least 1",
      AsyncOptionsError.barrierCapacity,
    );
  }
}

export class AsyncAggregateError extends AggregateError {
  constructor(errors: Iterable<unknown>, message: string, context?: Function) {
    super(errors, message);
    this.name = "AsyncAggregateError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static create(
    this: void,
    errors: Iterable<unknown>,
    message = "Some operations failed",
  ): AsyncAggregateError {
    return new AsyncAggregateError(errors, message, AsyncAggregateError.create);
  }
}
