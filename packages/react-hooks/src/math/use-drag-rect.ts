import type { Rectangle } from "@temelj/math";

import * as React from "react";

import { useDragVector, type DragVectorReturn } from "./use-drag-vector.ts";
import { useRect } from "./use-rect.ts";

/**
 * Drag vector state paired with the current element rectangle.
 */
export interface DragRectReturn<T extends Element> extends Omit<DragVectorReturn<T>, "ref"> {
  /** Ref callback for the draggable element. */
  ref: React.RefCallback<T>;
  /** Latest measured element rectangle. */
  rect: Rectangle | null;
}

/**
 * Combines useDragVector with useRect for drag interactions that need geometry.
 */
export function useDragRect<T extends Element>(): DragRectReturn<T> {
  const drag = useDragVector<T>();
  const [rectRef, rect] = useRect<T>();

  const ref = React.useCallback(
    (node: T | null) => {
      drag.ref.current = node;
      rectRef(node);
    },
    [drag.ref, rectRef],
  );

  return { ...drag, ref, rect };
}
