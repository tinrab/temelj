export function isPromise<T>(value: T | PromiseLike<T>): value is Promise<T> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function" &&
    "finally" in value &&
    typeof value.finally === "function"
  );
}
