import * as React from "react";

/**
 * Returns true only during the first render of a component instance.
 */
export function useIsFirstRender(): boolean {
  const first = React.useRef(true);
  if (first.current) {
    first.current = false;
    return true;
  }
  return false;
}
