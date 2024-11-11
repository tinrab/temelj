import type { Result, ResultErr, ResultOk } from "./types.ts";

export function ok<T, E>(value: T): Result<T, E> {
  return { value, error: undefined };
}

export function isOk<T, E = unknown>(
  result: Result<T, E>,
): result is ResultOk<T, E> {
  return result.error === undefined && result.value !== undefined;
}

export function err<T, E>(error: E): Result<T, E> {
  return { value: undefined, error };
}

export function isErr<T = unknown, E = unknown>(
  result: Result<T, E>,
): result is ResultErr<E> {
  return result.error !== undefined && result.value === undefined;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value;
  }
  throw new Error(`Result is Err: ${result.error}`);
}

export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (isErr(result)) {
    return result.error;
  }
  throw new Error(`Result is Ok: ${result.value}`);
}

export function unwrapOr<T, E>(
  result: Result<T, E>,
  defaultValue: T | (() => T),
): T {
  if (isOk(result)) {
    return result.value;
  }
  if (typeof defaultValue === "function") {
    return (defaultValue as () => T)();
  }
  return defaultValue;
}

export function map<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.value));
  }
  return err(result.error);
}

export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  if (isErr(result)) {
    return err(fn(result.error));
  }
  return ok(result.value);
}
