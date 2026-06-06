import * as React from "react";

/**
 * Controls returned by useBoolean.
 */
export interface BooleanControls {
  /** Sets the value to true. */
  setTrue: () => void;
  /** Sets the value to false. */
  setFalse: () => void;
  /** Toggles the current value or forces a supplied value. */
  toggle: (value?: boolean) => void;
  /** Sets the boolean value directly. */
  set: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Manages boolean state with ergonomic controls.
 */
export function useBoolean(initialValue = false): [boolean, BooleanControls] {
  const [value, setValue] = React.useState(initialValue);
  const setTrue = React.useCallback(() => setValue(true), []);
  const setFalse = React.useCallback(() => setValue(false), []);
  const toggle = React.useCallback((next?: boolean) => {
    setValue((current) => (typeof next === "boolean" ? next : !current));
  }, []);

  return [value, { setTrue, setFalse, toggle, set: setValue }];
}
