import { useMediaQuery } from "./use-media-query.ts";

/**
 * Reports whether the user prefers reduced motion.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
