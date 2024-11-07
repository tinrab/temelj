export function filterMap<T, U>(
  this: T[],
  filter: (e: T, i?: number) => U | undefined,
): U[] {
  const result: U[] = [];
  for (let i = 0; i < this.length; i++) {
    const item = filter(this[i], i);
    if (item !== undefined) {
      result.push(item);
    }
  }
  return result;
}

export function containsDuplicates<T>(
  arr: T[],
  compare?: (a: T, b: T) => boolean,
): boolean {
  if (compare === undefined) {
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (Object.is(a, b)) {
          return true;
        }
      }
    }
  } else {
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (compare(a, b)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function binarySearch<T>(
  arr: T[],
  value: T,
  compare: (a: T, b: T) => number,
): number {
  let low = 0;
  let high = arr.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compare(arr[mid], value) < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
