import * as React from "react";

/**
 * Returns the previous value only when the comparator reports that the value changed.
 */
export function usePrevious<T>(
  value: T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T | undefined {
  const [state, setState] = React.useState<{ current: T; previous: T | undefined }>(() => ({
    current: value,
    previous: undefined,
  }));

  if (!isEqual(state.current, value)) {
    setState({ current: value, previous: state.current });

    return state.current;
  }

  return state.previous;
}
