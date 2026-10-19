import { isString } from "@temelj/value";

/** Preserves Error instances and gives other thrown values an Error with their original cause. */
export function thrownError(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error(isString(cause) ? cause : "Non-Error value was thrown", { cause });
}

/** Maps failures into the caller's domain; a failed mapper remains an Error. */
export function mapThrownError<E>(cause: unknown, mapError?: (cause: unknown) => E): E | Error {
  if (mapError === undefined) return thrownError(cause);

  try {
    return mapError(cause);
  } catch (mappingCause) {
    return thrownError(mappingCause);
  }
}
