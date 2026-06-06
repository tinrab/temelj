import { useMediaQueries } from "./use-media-queries.ts";

/**
 * Returns the active breakpoint name for a min-width breakpoint map.
 */
export function useBreakpoint<const T extends Record<string, number>>(
  breakpoints: T,
): keyof T | null {
  const queries = {} as { [K in keyof T]: string };
  for (const key of Object.keys(breakpoints) as Array<keyof T>) {
    queries[key] = `(min-width: ${breakpoints[key]}px)`;
  }

  const matches = useMediaQueries(queries);
  let active: keyof T | null = null;
  let activeValue = Number.NEGATIVE_INFINITY;

  for (const key of Object.keys(breakpoints) as Array<keyof T>) {
    const value = breakpoints[key];
    if (matches[key] && value > activeValue) {
      active = key;
      activeValue = value;
    }
  }

  return active;
}
