/**
 * Returns a random index in the range [0, length).
 *
 * @param length The length of the array to sample from.
 * @returns A random index in the range [0, length), or undefined if the length is 0.
 */
export function sampleIndex(length: number): number | undefined {
  if (length === 0) {
    return undefined;
  }
  return Math.floor(Math.random() * length);
}

/**
 * Returns a list of random indices from the range [0, length).
 *
 * @param length The length of the array to sample from.
 * @param count The number of indices to sample.
 * @returns A list of random indices in the range [0, length).
 */
export function sampleListIndices(length: number, count: number): number[] {
  const indices: number[] = [];
  if (length === 0) {
    return indices;
  }
  for (let i = 0; i < count; i++) {
    indices.push(Math.floor(Math.random() * length));
  }
  return indices;
}

/**
 * Returns a list of random indices from the range [0, length).
 * The indices are guaranteed to be unique.
 *
 * @param length The length of the array to sample from.
 * @param count The number of indices to sample.
 * @returns A list of random indices in the range [0, length).
 */
export function sampleListUniqueIndices(
  length: number,
  count: number,
): number[] {
  if (length === 0) {
    return [];
  }
  const indices: number[] = shuffle(Array.from(
    { length: length },
    (_, i) => i,
  ));
  return indices.slice(0, Math.min(length, count));
}

/**
 * Returns a random sample of the given array.
 *
 * @param array The array to sample from.
 * @returns A random sample of the given array, or undefined if the array is empty.
 */
export function sample<T>(array: T[]): T | undefined {
  const j = sampleIndex(array.length);
  if (j === undefined) {
    return undefined;
  }
  return array[j];
}

/**
 * Returns a list of random samples of the given array.
 *
 * @param array The array to sample from.
 * @param count The number of samples to return.
 * @returns A list of random samples of the given array.
 */
export function sampleList<T>(array: T[], count: number): T[] {
  const s: T[] = [];
  for (let i = 0; i < count; i++) {
    const j = sampleIndex(array.length);
    if (j === undefined) {
      return s;
    }
    s.push(array[j]);
  }
  return s;
}

/**
 * Returns a list of random samples of the given array.
 * The samples' indices are guaranteed to be unique.
 *
 * @param array The array to sample from.
 * @param count The number of samples to return.
 * @returns A list of random samples of the given array.
 */
export function sampleListUnique<T>(array: T[], count: number): T[] {
  const indices = sampleListUniqueIndices(array.length, count);
  return indices.map((j) => array[j]);
}

/**
 * Shuffles the elements of the given array.
 *
 * @param array The array to shuffle.
 * @returns The shuffled array.
 */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length; i; i--) {
    const j = Math.floor(Math.random() * i);
    [array[i - 1], array[j]] = [array[j], array[i - 1]];
  }
  return array;
}
