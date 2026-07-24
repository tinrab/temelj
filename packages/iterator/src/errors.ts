export class IteratorOptionsError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "IteratorOptionsError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static stepNonZero(this: void): never {
    throw new IteratorOptionsError("Step cannot be zero", IteratorOptionsError.stepNonZero);
  }

  static chunkSizePositive(this: void): never {
    throw new IteratorOptionsError(
      "Chunk size must be greater than 0",
      IteratorOptionsError.chunkSizePositive,
    );
  }

  static windowSizePositive(this: void): never {
    throw new IteratorOptionsError(
      "Window size must be greater than 0",
      IteratorOptionsError.windowSizePositive,
    );
  }

  static combinationSizeNonNegative(this: void): never {
    throw new IteratorOptionsError(
      "Combination size must be non-negative",
      IteratorOptionsError.combinationSizeNonNegative,
    );
  }
}
