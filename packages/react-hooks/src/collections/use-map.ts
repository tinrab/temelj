import { useMutableCollection } from "../internal/use-mutable-collection.ts";

/**
 * Returns a Map that triggers rerenders when mutated through set, delete, or clear.
 */
export function useMap<K, V>(initialState?: Iterable<readonly [K, V]>): Map<K, V> {
  return useMutableCollection((notify) => {
    const map = new Map(initialState);
    const originalSet = map.set.bind(map);
    const originalDelete = map.delete.bind(map);
    const originalClear = map.clear.bind(map);
    map.set = function set(key: K, value: V) {
      const result = originalSet(key, value);
      notify();

      return result;
    };

    map.delete = function deleteKey(key: K) {
      const result = originalDelete(key);
      notify();

      return result;
    };

    map.clear = function clear() {
      originalClear();
      notify();
    };

    return map;
  });
}
