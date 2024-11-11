export function sampleIndex(length: number): number | undefined {
  if (length === 0) {
    return undefined;
  }
  return Math.floor(Math.random() * length);
}

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

export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length; i; i--) {
    const j = Math.floor(Math.random() * i);
    [array[i - 1], array[j]] = [array[j], array[i - 1]];
  }
  return array;
}

export function sample<T>(array: T[]): T | undefined {
  const j = sampleIndex(array.length);
  if (j === undefined) {
    return undefined;
  }
  return array[j];
}

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

export function sampleListUnique<T>(array: T[], count: number): T[] {
  const indices = sampleListUniqueIndices(array.length, count);
  return indices.map((j) => array[j]);
}
