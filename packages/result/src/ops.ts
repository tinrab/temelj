import type { Result, ResultErr, ResultOk } from "./types";

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

/**
 * Calls a function that may throw and returns a Result.
 *
 * @param fn - The synchronous function to execute.
 */
export function fromThrowable<T>(fn: () => T): Result<T, unknown>;

/**
 * Calls a function that may throw and returns a Result, mapping the error if one occurs.
 *
 * @param fn - The synchronous function to execute.
 * @param onErr - A function to convert the unknown thrown value to type E.
 */
export function fromThrowable<T, E>(
  fn: () => T,
  onErr: (e: unknown) => E,
): Result<T, E>;
export function fromThrowable<T, E>(
  fn: () => T,
  onErr?: (e: unknown) => E,
): Result<T, E | unknown> {
  try {
    return ok(fn());
  } catch (e) {
    return err(onErr ? onErr(e) : e);
  }
}

/**
 * Calls a function that returns a Promise and returns a Promise<Result>.
 * Catches both synchronous exceptions in the factory and asynchronous rejections.
 *
 * @param fn - The async function to execute.
 */
export function fromPromise<T>(
  fn: () => Promise<T>,
): Promise<Result<T, unknown>>;

/**
 * Calls a function that returns a Promise and returns a Promise<Result>, mapping the error if one occurs.
 *
 * @param fn - The async function to execute.
 * @param onErr - A function to convert the unknown rejection reason to type E.
 */
export function fromPromise<T, E>(
  fn: () => Promise<T>,
  onErr: (e: unknown) => E,
): Promise<Result<T, E>>;
export async function fromPromise<T, E>(
  fn: () => Promise<T>,
  onErr?: (e: unknown) => E,
): Promise<Result<T, E | unknown>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (e) {
    return err(onErr ? onErr(e) : e);
  }
}
