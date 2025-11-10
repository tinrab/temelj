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
