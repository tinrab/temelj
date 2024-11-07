export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length; i; i--) {
    const j = Math.floor(Math.random() * i);
    [array[i - 1], array[j]] = [array[j], array[i - 1]];
  }
  return array;
}

export function sampleIndex(length: number): number | undefined {
  if (length === 0) {
    return undefined;
  }
  return Math.floor(Math.random() * length);
}

export function sample<T>(array: T[]): T | undefined {
  const index = sampleIndex(array.length);
  if (index === undefined) {
    return undefined;
  }
  return array[index];
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

export function sampleList<T>(array: T[], count: number): T[] {
  const s: T[] = [];
  for (let i = 0; i < count; i++) {
    const index = sampleIndex(array.length);
    if (index === undefined) {
      return s;
    }
    s.push(array[index]);
  }
  return s;
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

export function sampleListUnique<T>(array: T[], count: number): T[] {
  const indices = sampleListUniqueIndices(array.length, count);
  return indices.map((index) => array[index]);
}
