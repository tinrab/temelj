import * as React from "react";

/**
 * Returns a Set that triggers rerenders when mutated through add, delete, or clear.
 */
export function useSet<T>(values?: Iterable<T>): Set<T> {
  const setRef = React.useRef(new Set(values));
  const [, rerender] = React.useReducer((value: number) => value + 1, 0);

  return React.useMemo(() => {
    const set = setRef.current;

    set.add = function add(value: T) {
      const result = Set.prototype.add.call(this, value);
      rerender();
      return result;
    };
    set.delete = function deleteValue(value: T) {
      const result = Set.prototype.delete.call(this, value);
      rerender();
      return result;
    };
    set.clear = function clear() {
      Set.prototype.clear.call(this);
      rerender();
    };
    return set;
  }, []);
}
