import type { Vector2 } from "@temelj/math";
import type * as React from "react";

import { rectangle } from "@temelj/math";

import { useRect } from "./use-rect.ts";

/**
 * Measures an element and returns its center as a Vector2.
 */
export function useElementCenter<T extends Element>(): [React.RefCallback<T>, Vector2 | null] {
  const [ref, rect] = useRect<T>();
  return [ref, rect === null ? null : rectangle.center(rect)];
}
