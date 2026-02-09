/**
 * Generates the cartesian product of two iterables.
 * Returns every possible pair from the two iterables.
 *
 * @param a The first iterable.
 * @param b The second iterable.
 * @returns An array of tuples containing all possible pairs.
 */
export function cartesianProduct<T, U>(
  a: Iterable<T>,
  b: Iterable<U>,
): [T, U][] {
  const bArray = Array.from(b);
  const result: [T, U][] = [];

  for (const itemA of a) {
    for (const itemB of bArray) {
      result.push([itemA, itemB]);
    }
  }

  return result;
}

/**
 * Generates all permutations of the input iterable.
 *
 * @param iterable The iterable to permute.
 * @returns An array of arrays, where each inner array is a unique permutation.
 */
export function permutations<T>(iterable: Iterable<T>): T[][] {
  const arr = Array.from(iterable);

  if (arr.length === 0) {
    return [];
  }

  const result: T[][] = [];

  function permute(current: T[], remaining: T[]) {
    if (remaining.length === 0) {
      result.push([...current]);
      return;
    }

    for (let i = 0; i < remaining.length; i++) {
      const next = remaining[i];
      const newRemaining = remaining.slice(0, i).concat(remaining.slice(i + 1));
      current.push(next);
      permute(current, newRemaining);
      current.pop();
    }
  }

  permute([], arr);
  return result;
}

/**
 * Generates all combinations of a specific size from the input iterable.
 *
 * @param iterable The iterable to generate combinations from.
 * @param n The size of each combination.
 * @returns An array of arrays, where each inner array is a unique combination of size n.
 */
export function combinations<T>(iterable: Iterable<T>, n: number): T[][] {
  const arr = Array.from(iterable);

  if (n < 0) {
    throw new Error("Combination size must be non-negative");
  }

  if (n === 0) {
    return [[]];
  }

  if (arr.length < n) {
    return [];
  }

  const result: T[][] = [];

  function combine(start: number, current: T[]) {
    if (current.length === n) {
      result.push([...current]);
      return;
    }

    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      combine(i + 1, current);
      current.pop();
    }
  }

  combine(0, []);
  return result;
}
