import * as React from "react";

interface UndoRedoStack<T> {
  past: T[];
  present: T;
  future: T[];
}

type UndoRedoAction<T> =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "set"; value: T; maxHistory: number | undefined }
  | { type: "clear"; value: T };

/**
 * Options for useUndoRedo.
 */
export interface UndoRedoOptions {
  /** Maximum number of past values to keep. */
  maxHistory?: number;
}

/**
 * State and controls returned by useUndoRedo.
 */
export interface UndoRedoState<T> {
  /** Current present value. */
  value: T;
  /** Previous values, oldest first. */
  past: T[];
  /** Redo values, newest first. */
  future: T[];
  /** Replaces the current value and records history. */
  set: (value: T) => void;
  /** Restore the previous value. */
  undo: () => void;
  /** Restore the next value. */
  redo: () => void;
  /** Resets history to the initial value. */
  clear: () => void;
  /** Whether undo is available. */
  canUndo: boolean;
  /** Whether redo is available. */
  canRedo: boolean;
}

function reducer<T>(state: UndoRedoStack<T>, action: UndoRedoAction<T>): UndoRedoStack<T> {
  if (action.type === "undo") {
    if (state.past.length === 0) return state;
    return {
      past: state.past.slice(0, -1),
      present: state.past[state.past.length - 1] as T,
      future: [state.present, ...state.future],
    };
  }
  if (action.type === "redo") {
    if (state.future.length === 0) return state;
    return {
      past: [...state.past, state.present],
      present: state.future[0] as T,
      future: state.future.slice(1),
    };
  }
  if (action.type === "set") {
    if (Object.is(state.present, action.value)) return state;
    const past = [...state.past, state.present];
    const boundedPast = action.maxHistory === undefined ? past : past.slice(-action.maxHistory);
    return { past: boundedPast, present: action.value, future: [] };
  }
  return { past: [], present: action.value, future: [] };
}

/**
 * Manages undo and redo state with optional history length limiting.
 */
export function useUndoRedo<T>(initialValue: T, options: UndoRedoOptions = {}): UndoRedoState<T> {
  const initialRef = React.useRef(initialValue);
  const [state, dispatch] = React.useReducer(reducer<T>, {
    past: [],
    present: initialRef.current,
    future: [],
  });

  const set = React.useCallback(
    (value: T) => dispatch({ type: "set", value, maxHistory: options.maxHistory }),
    [options.maxHistory],
  );
  const undo = React.useCallback(() => dispatch({ type: "undo" }), []);
  const redo = React.useCallback(() => dispatch({ type: "redo" }), []);
  const clear = React.useCallback(() => dispatch({ type: "clear", value: initialRef.current }), []);

  return {
    value: state.present,
    past: state.past,
    future: state.future,
    set,
    undo,
    redo,
    clear,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
