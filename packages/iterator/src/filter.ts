/**
 * Filters and maps an iterable, returning a new array of the mapped elements that passed the filter.
 *
 * @param it The iterable to filter and map.
 * @param filter A function that takes an element and its index, and returns the mapped element or `undefined` if the element should be filtered out.
 * @returns A new array containing the mapped elements that passed the filter.
 */
export function filterMap<T, U>(
  it: Iterable<T>,
  filter: (e: T, i: number) => U | undefined,
): U[] {
  const result: U[] = [];
  let i = 0;
  for (const e of it) {
    const item = filter(e, i);
    if (item !== undefined) {
      result.push(item);
    }
    i++;
  }
  return result;
}

/**
 * Splits an iterable into two arrays: one where the predicate is true, and one where it is false.
 *
 * @param iterable The iterable to partition.
 * @param predicate A function that returns true for elements that should go in the first array.
 * @returns A tuple of two arrays: [truthyElements, falsyElements].
 */
export function partition<T>(
  iterable: Iterable<T>,
  predicate: (item: T) => boolean,
): [T[], T[]] {
  const truthy: T[] = [];
  const falsy: T[] = [];

  for (const item of iterable) {
    if (predicate(item)) {
      truthy.push(item);
    } else {
      falsy.push(item);
    }
  }

  return [truthy, falsy];
}
