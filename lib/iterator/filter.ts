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
