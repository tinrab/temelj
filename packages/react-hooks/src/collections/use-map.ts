import * as React from "react";

/**
 * Returns a Map that triggers rerenders when mutated through set, delete, or clear.
 */
export function useMap<K, V>(initialState?: Iterable<readonly [K, V]>): Map<K, V> {
  const mapRef = React.useRef(new Map(initialState));
  const [, rerender] = React.useReducer((value: number) => value + 1, 0);

  return React.useMemo(() => {
    const map = mapRef.current;

    map.set = function set(key: K, value: V) {
      const result = Map.prototype.set.call(this, key, value);
      rerender();
      return result;
    };
    map.delete = function deleteKey(key: K) {
      const result = Map.prototype.delete.call(this, key);
      rerender();
      return result;
    };
    map.clear = function clear() {
      Map.prototype.clear.call(this);
      rerender();
    };
    return map;
  }, []);
}
