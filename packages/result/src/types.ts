/**
 * A result monad that can either be a success or an error.
 *
 * @template T The type of the success value.
 * @template E The type of the error value.
 */
export type Result<T, E> = ResultOk<T> | ResultErr<E>;

/**
 * A result value that is a success.
 *
 * @template T The type of the success value.
 */
export interface ResultOk<T> {
  readonly kind: "ok";
  readonly value: T;
}

/**
 * A result value that is an error.
 *
 * @template E The type of the error value.
 */
export interface ResultErr<E> {
  readonly kind: "error";
  readonly error: E;
}
