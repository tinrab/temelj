import { type Vector2, vector2 } from "@temelj/math";
import * as React from "react";

/**
 * Drag state returned by useDragVector.
 */
export interface DragVectorState {
  /** Whether a drag is currently active. */
  dragging: boolean;
  /** Drag start position. */
  start: Vector2 | null;
  /** Current pointer position. */
  current: Vector2 | null;
  /** Difference between current and start positions. */
  delta: Vector2;
}

/**
 * Pointer handlers and state returned by useDragVector.
 */
export interface DragVectorReturn<T extends Element> extends DragVectorState {
  /** Ref for the draggable element. */
  ref: React.RefObject<T | null>;
  /** Handler for pointer down. */
  onPointerDown: React.PointerEventHandler<T>;
  /** Handler for pointer move. */
  onPointerMove: React.PointerEventHandler<T>;
  /** Handler for pointer up. */
  onPointerUp: React.PointerEventHandler<T>;
  /** Handler for pointer cancellation. */
  onPointerCancel: React.PointerEventHandler<T>;
  /** Resets drag state. */
  reset: () => void;
}

function eventVector<T extends Element>(event: React.PointerEvent<T>, node: T | null): Vector2 {
  if (!node) return vector2.of(event.clientX, event.clientY);
  const bounds = node.getBoundingClientRect();
  return vector2.of(event.clientX - bounds.left, event.clientY - bounds.top);
}

/**
 * Tracks pointer drag start, current, and delta positions as Vector2 values.
 */
export function useDragVector<T extends Element>(): DragVectorReturn<T> {
  const ref = React.useRef<T | null>(null);
  const [state, setState] = React.useState<DragVectorState>({
    dragging: false,
    start: null,
    current: null,
    delta: vector2.zero(),
  });

  const reset = React.useCallback(() => {
    setState({ dragging: false, start: null, current: null, delta: vector2.zero() });
  }, []);

  const onPointerDown = React.useCallback<React.PointerEventHandler<T>>((event) => {
    const start = eventVector(event, ref.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    setState({ dragging: true, start, current: start, delta: vector2.zero() });
  }, []);

  const onPointerMove = React.useCallback<React.PointerEventHandler<T>>((event) => {
    setState((currentState) => {
      if (!currentState.dragging || currentState.start === null) return currentState;
      const current = eventVector(event, ref.current);
      return {
        dragging: true,
        start: currentState.start,
        current,
        delta: vector2.minus(current, currentState.start),
      };
    });
  }, []);

  const onPointerUp = React.useCallback<React.PointerEventHandler<T>>((event) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setState((currentState) => ({ ...currentState, dragging: false }));
  }, []);

  return {
    ...state,
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    reset,
  };
}
