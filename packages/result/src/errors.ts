export class ResultUnwrapError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "ResultUnwrapError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static expectedErr(this: void): never {
    throw new ResultUnwrapError(
      "Expected an error result, received an Ok result",
      ResultUnwrapError.expectedErr,
    );
  }
}
