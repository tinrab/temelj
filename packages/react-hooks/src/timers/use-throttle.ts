import * as React from "react";

/**
 * Returns a throttled version of a changing value.
 */
export function useThrottle<T>(value: T, interval = 500): T {
  const [throttledValue, setThrottledValue] = React.useState(value);
  const lastUpdated = React.useRef(0);

  React.useEffect(() => {
    const now = Date.now();
    const remaining = interval - (now - lastUpdated.current);

    if (remaining <= 0) {
      lastUpdated.current = now;
      setThrottledValue(value);
      return undefined;
    }

    const id = setTimeout(() => {
      lastUpdated.current = Date.now();
      setThrottledValue(value);
    }, remaining);
    return () => clearTimeout(id);
  }, [value, interval]);

  return throttledValue;
}
