/**
 * Collects the values from an iterable into a record, using the result of
 * `getKey` as the key and the result of `map` as the value.
 *
 * @param it The iterable to collect from.
 * @param getKey A function that takes an element from the iterable and returns a key.
 * @param map An optional function that takes an element from the iterable and returns a value.
 * @returns A record where the keys are the result of calling `getKey` on each element, and the values are the result of calling `map` on each element.
 */
export function collectMap<K extends keyof any, V, V1 = V>(
  it: Iterable<V>,
  getKey: (e: V) => K,
  map: (e: V) => V1 = (v) => v as unknown as V1,
): Record<K, V1> {
  const result = {} as Record<K, V1>;
  for (const e of it) {
    result[getKey(e)] = map(e);
  }
  return result;
}

/**
 * Finds the minimum element using a selector function.
 *
 * @param iterable The iterable to search.
 * @param selector A function that returns a comparable value for each element.
 * @returns The minimum element, or undefined if the iterable is empty.
 */
export function minBy<T>(
  iterable: Iterable<T>,
  selector: (item: T) => number,
): T | undefined {
  let minItem: T | undefined;
  let minValue = Infinity;

  for (const item of iterable) {
    const value = selector(item);
    if (value < minValue) {
      minValue = value;
      minItem = item;
    }
  }

  return minItem;
}

/**
 * Finds the maximum element using a selector function.
 *
 * @param iterable The iterable to search.
 * @param selector A function that returns a comparable value for each element.
 * @returns The maximum element, or undefined if the iterable is empty.
 */
export function maxBy<T>(
  iterable: Iterable<T>,
  selector: (item: T) => number,
): T | undefined {
  let maxItem: T | undefined;
  let maxValue = -Infinity;

  for (const item of iterable) {
    const value = selector(item);
    if (value > maxValue) {
      maxValue = value;
      maxItem = item;
    }
  }

  return maxItem;
}

/**
 * Splits an iterable into arrays of a specific size.
 *
 * @param iterable The iterable to chunk.
 * @param size The size of each chunk.
 * @returns An array of chunks.
 */
export function chunk<T>(iterable: Iterable<T>, size: number): T[][] {
  if (size <= 0) {
    throw new Error("Chunk size must be greater than 0");
  }

  const result: T[][] = [];
  let currentChunk: T[] = [];

  for (const item of iterable) {
    currentChunk.push(item);
    if (currentChunk.length === size) {
      result.push(currentChunk);
      currentChunk = [];
    }
  }

  if (currentChunk.length > 0) {
    result.push(currentChunk);
  }

  return result;
}

/**
 * Yields a sliding window over the iterable.
 *
 * @param iterable The iterable to window.
 * @param size The size of each window.
 * @returns An array of windows.
 */
export function window<T>(iterable: Iterable<T>, size: number): T[][] {
  if (size <= 0) {
    throw new Error("Window size must be greater than 0");
  }

  const result: T[][] = [];
  const buffer: T[] = [];

  for (const item of iterable) {
    buffer.push(item);
    if (buffer.length > size) {
      buffer.shift();
    }
    if (buffer.length === size) {
      result.push([...buffer]);
    }
  }

  return result;
}

/**
 * Combines two iterables into tuples until one is exhausted.
 *
 * @param a The first iterable.
 * @param b The second iterable.
 * @returns An array of tuples.
 */
export function zip<T, U>(a: Iterable<T>, b: Iterable<U>): [T, U][] {
  const result: [T, U][] = [];
  const iterA = a[Symbol.iterator]();
  const iterB = b[Symbol.iterator]();

  while (true) {
    const nextA = iterA.next();
    const nextB = iterB.next();

    if (nextA.done || nextB.done) {
      break;
    }

    result.push([nextA.value, nextB.value]);
  }

  return result;
}

/**
 * Flattens nested iterables by one level.
 *
 * @param iterable The iterable to flatten.
 * @returns An array of flattened elements.
 */
export function flatten<T>(iterable: Iterable<Iterable<T> | T>): T[] {
  const result: T[] = [];

  for (const item of iterable) {
    if (typeof item === "object" && item !== null && Symbol.iterator in item) {
      for (const inner of item as Iterable<T>) {
        result.push(inner);
      }
    } else {
      result.push(item as T);
    }
  }

  return result;
}

/**
 * Groups elements from an iterable using a key selector function.
 *
 * @param it The iterable to group.
 * @param getKey A function that derives a key from an element.
 * @returns A Map where keys are the result of calling `getKey` on each element, and values are arrays of elements with that key.
 */
export function groupBy<T, K>(
  it: Iterable<T>,
  getKey: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of it) {
    const key = getKey(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

/**
 * Returns a sequence of unique items from an iterable.
 * Supports a custom identity function for filtering objects by a property.
 *
 * @param iterable The iterable to filter for unique items.
 * @param identity An optional function that returns a value to use for uniqueness comparison.
 * @returns An array of unique items.
 */
export function unique<T>(
  iterable: Iterable<T>,
  identity?: (item: T) => unknown,
): T[] {
  const result: T[] = [];
  const seen = new Set<unknown>();

  for (const item of iterable) {
    const key = identity ? identity(item) : item;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

/**
 * Returns items in `a` that are not in `b`.
 *
 * @param a The first iterable.
 * @param b The second iterable.
 * @returns An array of items in `a` but not in `b`.
 */
export function difference<T>(a: Iterable<T>, b: Iterable<T>): T[] {
  const bSet = new Set(b);
  const result: T[] = [];

  for (const item of a) {
    if (!bSet.has(item)) {
      result.push(item);
    }
  }

  return result;
}

/**
 * Returns items present in both `a` and `b`.
 *
 * @param a The first iterable.
 * @param b The second iterable.
 * @returns An array of items present in both iterables.
 */
export function intersection<T>(a: Iterable<T>, b: Iterable<T>): T[] {
  const bSet = new Set(b);
  const result: T[] = [];

  for (const item of a) {
    if (bSet.has(item) && !result.includes(item)) {
      result.push(item);
    }
  }

  return result;
}

/**
 * Creates an iterator that yields the first `n` elements of the given iterable.
 *
 * @param iterable The iterable to take from.
 * @param n The number of elements to take.
 * @returns An array containing the first `n` elements.
 */
export function take<T>(iterable: Iterable<T>, n: number): T[] {
  if (n <= 0) {
    return [];
  }

  const result: T[] = [];
  let count = 0;

  for (const item of iterable) {
    result.push(item);
    count++;
    if (count >= n) {
      break;
    }
  }

  return result;
}

/**
 * Creates an iterator that skips the first `n` elements of the given iterable.
 *
 * @param iterable The iterable to skip from.
 * @param n The number of elements to skip.
 * @returns An array containing the remaining elements after skipping `n`.
 */
export function skip<T>(iterable: Iterable<T>, n: number): T[] {
  if (n <= 0) {
    return Array.from(iterable);
  }

  const result: T[] = [];
  let count = 0;

  for (const item of iterable) {
    if (count >= n) {
      result.push(item);
    }
    count++;
  }

  return result;
}

/**
 * Returns the first element of an iterable, or `undefined` if empty.
 *
 * @param iterable The iterable to get the first element from.
 * @returns The first element, or `undefined` if empty.
 */
export function first<T>(iterable: Iterable<T>): T | undefined {
  const iterator = iterable[Symbol.iterator]();
  const result = iterator.next();
  return result.done ? undefined : result.value;
}

/**
 * Returns the last element of an iterable, or `undefined` if empty.
 *
 * @param iterable The iterable to get the last element from.
 * @returns The last element, or `undefined` if empty.
 */
export function last<T>(iterable: Iterable<T>): T | undefined {
  let lastItem: T | undefined;
  let hasItem = false;

  for (const item of iterable) {
    lastItem = item;
    hasItem = true;
  }

  return hasItem ? lastItem : undefined;
}

/**
 * Checks if an iterable is empty.
 *
 * @param iterable The iterable to check.
 * @returns `true` if the iterable is empty, `false` otherwise.
 */
export function isEmpty<T>(iterable: Iterable<T>): boolean {
  const iterator = iterable[Symbol.iterator]();
  return iterator.next().done ?? true;
}

/**
 * Creates an iterator that yields elements while the predicate returns `true`.
 *
 * @param iterable The iterable to take from.
 * @param predicate A function that returns `true` for elements to include.
 * @returns An array containing elements while the predicate was true.
 */
export function takeWhile<T>(
  iterable: Iterable<T>,
  predicate: (item: T) => boolean,
): T[] {
  const result: T[] = [];

  for (const item of iterable) {
    if (!predicate(item)) {
      break;
    }
    result.push(item);
  }

  return result;
}

/**
 * Creates an iterator that skips elements while the predicate returns `true`.
 *
 * @param iterable The iterable to skip from.
 * @param predicate A function that returns `true` for elements to skip.
 * @returns An array containing elements after the predicate returned `false`.
 */
export function skipWhile<T>(
  iterable: Iterable<T>,
  predicate: (item: T) => boolean,
): T[] {
  const result: T[] = [];
  let skipping = true;

  for (const item of iterable) {
    if (skipping) {
      if (!predicate(item)) {
        skipping = false;
        result.push(item);
      }
    } else {
      result.push(item);
    }
  }

  return result;
}

/**
 * Finds the first element matching a predicate, or `undefined` if none match.
 *
 * @param iterable The iterable to search.
 * @param predicate A function that returns `true` for the desired element.
 * @returns The first matching element, or `undefined` if not found.
 */
export function find<T>(
  iterable: Iterable<T>,
  predicate: (item: T) => boolean,
): T | undefined {
  for (const item of iterable) {
    if (predicate(item)) {
      return item;
    }
  }
  return undefined;
}

/**
 * Checks if any element satisfies the predicate.
 *
 * @param iterable The iterable to check.
 * @param predicate A function that returns `true` for matching elements.
 * @returns `true` if any element satisfies the predicate, `false` otherwise.
 */
export function any<T>(
  iterable: Iterable<T>,
  predicate: (item: T) => boolean,
): boolean {
  for (const item of iterable) {
    if (predicate(item)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if all elements satisfy the predicate.
 *
 * @param iterable The iterable to check.
 * @param predicate A function that returns `true` for matching elements.
 * @returns `true` if all elements satisfy the predicate, `false` otherwise.
 */
export function all<T>(
  iterable: Iterable<T>,
  predicate: (item: T) => boolean,
): boolean {
  for (const item of iterable) {
    if (!predicate(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Counts the number of elements in an iterable, or counts elements matching a predicate.
 *
 * @param iterable The iterable to count.
 * @param predicate An optional predicate to filter elements.
 * @returns The count of elements.
 */
export function count<T>(
  iterable: Iterable<T>,
  predicate?: (item: T) => boolean,
): number {
  let counter = 0;

  for (const item of iterable) {
    if (predicate === undefined || predicate(item)) {
      counter++;
    }
  }

  return counter;
}

/**
 * Combines two iterables into a set of unique items from both.
 *
 * @param a The first iterable.
 * @param b The second iterable.
 * @returns An array of unique items from both iterables.
 */
export function union<T>(a: Iterable<T>, b: Iterable<T>): T[] {
  const seen = new Set<T>();
  const result: T[] = [];

  for (const item of a) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }

  for (const item of b) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }

  return result;
}
