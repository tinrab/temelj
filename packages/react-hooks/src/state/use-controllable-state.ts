import * as React from "react";

/**
 * Options for useControllableState.
 */
export interface ControllableStateOptions<T> {
  /** Controlled value. */
  value?: T;
  /** Initial value for uncontrolled usage. */
  defaultValue: T;
  /** Called whenever the setter receives a next value. */
  onChange?: (value: T) => void;
}

/**
 * Manages state that can be either controlled or uncontrolled.
 */
export function useControllableState<T>(
  options: ControllableStateOptions<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const { value, defaultValue, onChange } = options;
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : uncontrolledValue;

  const setValue = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (next) => {
      const nextValue = typeof next === "function" ? (next as (value: T) => T)(currentValue) : next;
      if (!isControlled) {
        setUncontrolledValue(nextValue);
      }
      onChange?.(nextValue);
    },
    [currentValue, isControlled, onChange],
  );

  return [currentValue, setValue];
}
