import * as React from "react";

/**
 * Returns the previous value from the last render commit.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = React.useRef<T | undefined>(undefined);
  React.useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
