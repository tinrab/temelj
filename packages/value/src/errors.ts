export class ValueConversionError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "ValueConversionError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static notPrimitive(this: void, description: string): never {
    throw new ValueConversionError(
      `Cannot convert value to primitive: ${description}`,
      ValueConversionError.notPrimitive,
    );
  }
}
