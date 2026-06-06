import type * as React from "react";

/**
 * Assigns a value to an object or callback ref.
 */
export function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

/**
 * Combines multiple refs into a single callback ref.
 */
export function useMergedRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      assignRef(ref, value);
    }
  };
}
