import * as React from "react";

/**
 * Manages a boolean value with an optional forced next state.
 */
export function useToggle(initialValue = false): [boolean, (value?: boolean) => void] {
  const [on, setOn] = React.useState(Boolean(initialValue));
  const toggle = React.useCallback((value?: boolean) => {
    setOn((current) => (typeof value === "boolean" ? value : !current));
  }, []);
  return [on, toggle];
}
