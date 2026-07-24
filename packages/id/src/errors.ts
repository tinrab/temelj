export class IdOptionsError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "IdOptionsError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static invalidUlidRandomBytes(this: void): never {
    throw new IdOptionsError("Invalid random bytes", IdOptionsError.invalidUlidRandomBytes);
  }

  static ulidListRandomBytesUnsupported(this: void): never {
    throw new IdOptionsError(
      "Cannot generate multiple ULIDs with the same random bytes",
      IdOptionsError.ulidListRandomBytesUnsupported,
    );
  }
}
