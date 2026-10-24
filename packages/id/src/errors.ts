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

  static invalidUlidTime(this: void): never {
    throw new IdOptionsError(
      "ULID time must be a non-negative 48-bit integer",
      IdOptionsError.invalidUlidTime,
    );
  }

  static invalidUlidCount(this: void): never {
    throw new IdOptionsError(
      "ULID count must be a non-negative safe integer",
      IdOptionsError.invalidUlidCount,
    );
  }

  static ulidListRandomBytesUnsupported(this: void): never {
    throw new IdOptionsError(
      "Cannot generate multiple ULIDs with the same random bytes",
      IdOptionsError.ulidListRandomBytesUnsupported,
    );
  }
}
