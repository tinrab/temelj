import { clamp } from "@temelj/math";
import * as React from "react";

/**
 * Bounds and step configuration for useCounter.
 */
export interface CounterOptions {
  /** Minimum allowed value. */
  min?: number;
  /** Maximum allowed value. */
  max?: number;
  /** Amount used by increment and decrement. */
  step?: number;
}

/**
 * Controls returned by useCounter.
 */
export interface CounterControls {
  /** Increase the counter by step. */
  increment: () => void;
  /** Decrease the counter by step. */
  decrement: () => void;
  /** Replace or set the current value. */
  set: (value: number) => void;
  /** Resets state back to idle. */
  reset: () => void;
}

/**
 * Manages a bounded numeric counter.
 */
export function useCounter(
  startingValue = 0,
  options: CounterOptions = {},
): [number, CounterControls] {
  const { min = -Infinity, max = Infinity, step = 1 } = options;
  const boundedStart = clamp(startingValue, min, max);
  const [count, setCount] = React.useState(boundedStart);

  const set = React.useCallback((value: number) => setCount(clamp(value, min, max)), [min, max]);
  const increment = React.useCallback(
    () => setCount((value) => clamp(value + step, min, max)),
    [step, min, max],
  );
  const decrement = React.useCallback(
    () => setCount((value) => clamp(value - step, min, max)),
    [step, min, max],
  );
  const reset = React.useCallback(() => setCount(boundedStart), [boundedStart]);

  return [count, { increment, decrement, set, reset }];
}
