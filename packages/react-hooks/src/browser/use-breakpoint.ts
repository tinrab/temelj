import { useMediaQueries } from "./use-media-queries.ts";

/** Named minimum viewport widths in pixels. */
export type Breakpoints<K extends string> = Readonly<Record<K, number>>;

/** Returns the active name from an own enumerable min-width breakpoint map. */
export function useBreakpoint<K extends string>(breakpoints: Breakpoints<K>): K | null {
  const entries = Object.entries<number>(breakpoints);

  const queries = Object.fromEntries(
    entries.map(([key, width]) => [key, `(min-width: ${width}px)`]),
  );

  const matches = useMediaQueries(queries);
  let active: string | null = null;
  let activeValue = Number.NEGATIVE_INFINITY;

  for (const [key, width] of entries) {
    if (matches[key] && width > activeValue) {
      active = key;
      activeValue = width;
    }
  }

  // SAFETY: A selected name comes directly from the supplied breakpoint keys; no match remains null.
  return active as K | null;
}
