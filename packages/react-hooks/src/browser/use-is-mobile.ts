import { useMediaQuery } from "./use-media-query.ts";

/**
 * Default viewport width, in pixels, used by useIsMobile.
 */
export const MOBILE_BREAKPOINT = 768;

/**
 * Reports whether the viewport is below the mobile breakpoint using useMediaQuery.
 */
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  return useMediaQuery(`(max-width: ${breakpoint - 1}px)`);
}
