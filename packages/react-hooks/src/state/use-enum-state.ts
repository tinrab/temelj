import * as React from "react";

/**
 * Controls returned by useEnumState.
 */
export interface EnumStateControls<T extends string> {
  /** Sets the current enum value when it is allowed. */
  set: (value: T) => void;
  /** Advances to the next allowed value. */
  next: () => void;
  /** Moves to the previous allowed value. */
  previous: () => void;
  /** Resets to the initial value. */
  reset: () => void;
  /** Allowed values for this state. */
  values: readonly T[];
}

/**
 * Manages state constrained to a fixed list of string values.
 */
export function useEnumState<T extends string>(
  values: readonly T[],
  initialValue: T = values[0] as T,
): [T, EnumStateControls<T>] {
  const initialRef = React.useRef(initialValue);
  const [value, setValue] = React.useState(initialValue);

  const set = React.useCallback(
    (next: T) => {
      if (values.includes(next)) setValue(next);
    },
    [values],
  );

  const next = React.useCallback(() => {
    setValue((current) => {
      const index = values.indexOf(current);
      return values[(index + 1) % values.length] as T;
    });
  }, [values]);

  const previous = React.useCallback(() => {
    setValue((current) => {
      const index = values.indexOf(current);
      return values[(index - 1 + values.length) % values.length] as T;
    });
  }, [values]);

  const reset = React.useCallback(() => setValue(initialRef.current), []);

  return [value, { set, next, previous, reset, values }];
}
