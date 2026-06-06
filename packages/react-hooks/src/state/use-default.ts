import * as React from "react";

/**
 * Returns a fallback value whenever state is null or undefined.
 */
export function useDefault<T>(
  initialValue: T | null | undefined,
  defaultValue: T,
): [T, React.Dispatch<React.SetStateAction<T | null | undefined>>] {
  const [state, setState] = React.useState<T | null | undefined>(initialValue);
  return [state == null ? defaultValue : state, setState];
}
