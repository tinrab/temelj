export function binarySearch<T>(
  arr: T[],
  value: T,
  compare: (a: T, b: T) => number,
): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compare(arr[mid], value) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
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
