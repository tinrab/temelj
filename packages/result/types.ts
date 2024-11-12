/**
 * A result monad that can either be a success or an error.
 *
 * @template T The type of the success value.
 * @template E The type of the error value.
 */
export type Result<T, E> = ResultOk<T, E> | ResultErr<E>;

/**
 * A result value that is a success.
 *
 * @template T The type of the success value.
 * @template E The type of the error value.
 */
export interface ResultOk<T, _E> {
  value: T;
  error: undefined;
}

/**
 * A result value that is an error.
 *
 * @template E The type of the error value.
 * @template T The type of the success value.
 */
export interface ResultErr<E> {
  value: undefined;
  error: E;
}
