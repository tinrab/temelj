// deno-lint-ignore no-explicit-any
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
