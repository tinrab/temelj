export class ResultUnwrapError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "ResultUnwrapError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static expectedErr(this: void, value: unknown): never {
    throw new ResultUnwrapError(`Result is Ok: ${String(value)}`, ResultUnwrapError.expectedErr);
  }
}
