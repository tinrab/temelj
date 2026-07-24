export function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return value !== undefined;
}
