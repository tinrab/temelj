import * as React from "react";

/**
 * Returns the number of times the component has rendered.
 */
export function useRenderCount(): number {
  const count = React.useRef(0);
  count.current++;
  return count.current;
}
