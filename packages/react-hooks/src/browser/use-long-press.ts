import type * as ReactTypes from "react";

import * as React from "react";

/**
 * Callbacks and threshold for useLongPress gesture handling.
 */
export interface LongPressOptions {
  /** Duration in milliseconds before a press counts as long. */
  threshold?: number;
  /** Called when pressing starts. */
  onStart?: (event: ReactTypes.MouseEvent | ReactTypes.TouchEvent) => void;
  /** Called after a completed long press ends. */
  onFinish?: (event: ReactTypes.MouseEvent | ReactTypes.TouchEvent) => void;
  /** Called when pressing ends before the threshold. */
  onCancel?: (event: ReactTypes.MouseEvent | ReactTypes.TouchEvent) => void;
}

/**
 * React pointer handlers returned by useLongPress.
 */
export interface LongPressHandlers {
  /** Handler for mouse down. */
  onMouseDown: (event: ReactTypes.MouseEvent) => void;
  /** Handler for mouse up. */
  onMouseUp: (event: ReactTypes.MouseEvent) => void;
  /** Handler for mouse leave. */
  onMouseLeave: (event: ReactTypes.MouseEvent) => void;
  /** Handler for touch start. */
  onTouchStart: (event: ReactTypes.TouchEvent) => void;
  /** Handler for touch end. */
  onTouchEnd: (event: ReactTypes.TouchEvent) => void;
}

/**
 * Returns mouse and touch handlers that invoke a callback after a press threshold.
 */
export function useLongPress(
  callback: (event: ReactTypes.MouseEvent | ReactTypes.TouchEvent) => void,
  options: LongPressOptions = {},
): LongPressHandlers {
  const { threshold = 400, onStart, onFinish, onCancel } = options;
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRef = React.useRef(false);
  const pressedRef = React.useRef(false);

  const start = React.useCallback(
    (event: ReactTypes.MouseEvent | ReactTypes.TouchEvent) => {
      if (pressedRef.current) return;
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);

      onStart?.(event);
      pressedRef.current = true;
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        callback(event);
        activeRef.current = true;
      }, threshold);
    },
    [callback, onStart, threshold],
  );

  const cancel = React.useCallback(
    (event: ReactTypes.MouseEvent | ReactTypes.TouchEvent) => {
      if (activeRef.current) onFinish?.(event);
      else if (pressedRef.current) onCancel?.(event);
      activeRef.current = false;
      pressedRef.current = false;
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    },
    [onCancel, onFinish],
  );

  return {
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchEnd: cancel,
  };
}
