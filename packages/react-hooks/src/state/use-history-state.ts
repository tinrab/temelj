import * as React from "react";

interface HistoryStack<T> {
  past: T[];
  present: T;
  future: T[];
}

type HistoryAction<T> =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "set"; value: T }
  | { type: "clear"; value: T };

/**
 * Undo and redo state returned by useHistoryState.
 */
export interface HistoryState<T> {
  /** Current present value. */
  state: T;
  /** Replace or set the current value. */
  set: (value: T) => void;
  /** Restore the previous value. */
  undo: () => void;
  /** Restore the next value. */
  redo: () => void;
  /** Clear the current collection or history. */
  clear: () => void;
  /** Whether undo is available. */
  canUndo: boolean;
  /** Whether redo is available. */
  canRedo: boolean;
}

function historyReducer<T>(state: HistoryStack<T>, action: HistoryAction<T>): HistoryStack<T> {
  if (action.type === "undo") {
    if (state.past.length === 0) {
      return state;
    }
    return {
      past: state.past.slice(0, -1),
      present: state.past[state.past.length - 1] as T,
      future: [state.present, ...state.future],
    };
  }
  if (action.type === "redo") {
    if (state.future.length === 0) {
      return state;
    }
    return {
      past: [...state.past, state.present],
      present: state.future[0] as T,
      future: state.future.slice(1),
    };
  }
  if (action.type === "set") {
    if (Object.is(action.value, state.present)) {
      return state;
    }
    return { past: [...state.past, state.present], present: action.value, future: [] };
  }
  return { past: [], present: action.value, future: [] };
}

/**
 * Manages state with undo, redo, and clear history controls.
 */
export function useHistoryState<T>(initialPresent: T): HistoryState<T> {
  const initialRef = React.useRef(initialPresent);
  const [history, dispatch] = React.useReducer(historyReducer<T>, {
    past: [],
    present: initialRef.current,
    future: [],
  });

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const set = React.useCallback((value: T) => dispatch({ type: "set", value }), []);
  const undo = React.useCallback(() => dispatch({ type: "undo" }), []);
  const redo = React.useCallback(() => dispatch({ type: "redo" }), []);
  const clear = React.useCallback(() => dispatch({ type: "clear", value: initialRef.current }), []);

  return { state: history.present, set, undo, redo, clear, canUndo, canRedo };
}
