import { useMediaQuery } from "./use-media-query.ts";

/**
 * Color scheme preference reported by useColorScheme.
 */
export type ColorScheme = "light" | "dark";

/**
 * Reports the user's preferred color scheme.
 */
export function useColorScheme(): ColorScheme {
  return useMediaQuery("(prefers-color-scheme: dark)") ? "dark" : "light";
}
