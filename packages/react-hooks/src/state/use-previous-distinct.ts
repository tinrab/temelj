import * as React from "react";

/**
 * Returns the previous value only when the comparator reports that the value changed.
 */
export function usePreviousDistinct<T>(
  value: T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T | undefined {
  const currentRef = React.useRef(value);
  const previousRef = React.useRef<T | undefined>(undefined);

  if (!isEqual(currentRef.current, value)) {
    previousRef.current = currentRef.current;
    currentRef.current = value;
  }

  return previousRef.current;
}
