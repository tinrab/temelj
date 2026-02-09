/**
 * A deferred promise with externally accessible `resolve` and `reject` functions.
 */
export interface Deferred<T> {
  /** The underlying promise. */
  readonly promise: Promise<T>;
  /** Resolves the promise with the given value. */
  readonly resolve: (value: T | PromiseLike<T>) => void;
  /** Rejects the promise with the given reason. */
  readonly reject: (reason?: unknown) => void;
}

/**
 * Creates a deferred promise, exposing `resolve` and `reject` alongside the promise itself.
 */
export function defer<T>(): Deferred<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
}
