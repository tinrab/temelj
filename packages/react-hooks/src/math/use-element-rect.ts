import type { Rectangle } from "@temelj/math";
import type * as React from "react";

import { useRect } from "./use-rect.ts";

/**
 * Measures an element as a Rectangle.
 *
 * This is an explicit alias for useRect for callers that prefer element-oriented naming.
 */
export function useElementRect<T extends Element>(): [React.RefCallback<T>, Rectangle | null] {
  return useRect<T>();
}
