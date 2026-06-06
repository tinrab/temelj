import { type Rectangle, rectangle } from "@temelj/math";
import * as React from "react";

import { useRect } from "./use-rect.ts";

/**
 * Rectangle intersection state returned by useRectIntersection.
 */
export interface RectIntersectionState {
  /** Latest first rectangle measurement. */
  first: Rectangle | null;
  /** Latest second rectangle measurement. */
  second: Rectangle | null;
  /** Whether both rectangles are present and overlapping. */
  intersects: boolean;
}

/**
 * Measures two elements and reports whether their rectangles overlap.
 */
export function useRectIntersection<A extends Element, B extends Element>(): [
  React.RefCallback<A>,
  React.RefCallback<B>,
  RectIntersectionState,
] {
  const [firstRef, first] = useRect<A>();
  const [secondRef, second] = useRect<B>();
  const intersects = first !== null && second !== null && rectangle.overlaps(first, second);

  return [firstRef, secondRef, { first, second, intersects }];
}
