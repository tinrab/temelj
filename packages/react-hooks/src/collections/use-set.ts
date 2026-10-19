import { useMutableCollection } from "../internal/use-mutable-collection.ts";

/**
 * Returns a Set that triggers rerenders when mutated through add, delete, or clear.
 */
export function useSet<T>(values?: Iterable<T>): Set<T> {
  return useMutableCollection((notify) => {
    const set = new Set(values);
    const originalAdd = set.add.bind(set);
    const originalDelete = set.delete.bind(set);
    const originalClear = set.clear.bind(set);
    set.add = function add(value: T) {
      const result = originalAdd(value);
      notify();

      return result;
    };

    set.delete = function deleteValue(value: T) {
      const result = originalDelete(value);
      notify();

      return result;
    };

    set.clear = function clear() {
      originalClear();
      notify();
    };

    return set;
  });
}
