import * as React from "react";

/**
 * Returns a stable function that reports whether the component is still mounted.
 */
export function useMounted(): () => boolean {
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return React.useCallback(() => mountedRef.current, []);
}
