// deno-lint-ignore-file no-explicit-any

import type { Result, ResultErr, ResultOk } from "./types.ts";

export function ok<T>(value: T): ResultOk<T> {
  return { kind: "ok", value };
}

export function err<E>(error: E): ResultErr<E> {
  return { kind: "error", error };
}

export function isOk<T, E>(result: Result<T, E>): result is ResultOk<T> {
  return result.kind === "ok";
}

export function isErr<T, E>(result: Result<T, E>): result is ResultErr<E> {
  return result.kind === "error";
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value;
  }
  throw result.error;
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

export function mapErr<E, F>(
  result: Result<any, E>,
  fn: (error: E) => F,
): Result<any, F> {
  if (isErr(result)) {
    return err(fn(result.error));
  }
  return result;
}
