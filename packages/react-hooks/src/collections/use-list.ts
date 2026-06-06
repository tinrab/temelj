import * as React from "react";

/**
 * Mutating helpers returned by useList.
 */
export interface ListControls<T> {
  /** Replace or set the current value. */
  set: (list: T[]) => void;
  /** Append an element. */
  push: (element: T) => void;
  /** Remove an element by index. */
  removeAt: (index: number) => void;
  /** Insert an element at an index. */
  insertAt: (index: number, element: T) => void;
  /** Replace an element at an index. */
  updateAt: (index: number, element: T) => void;
  /** Clear the current collection or history. */
  clear: () => void;
}

/**
 * Manages an array with stable helper functions for common list operations.
 */
export function useList<T>(defaultList: T[] = []): [T[], ListControls<T>] {
  const [list, setList] = React.useState(defaultList);
  const set = React.useCallback((next: T[]) => setList(next), []);
  const push = React.useCallback((element: T) => setList((value) => [...value, element]), []);
  const removeAt = React.useCallback((index: number) => {
    setList((value) => [...value.slice(0, index), ...value.slice(index + 1)]);
  }, []);
  const insertAt = React.useCallback((index: number, element: T) => {
    setList((value) => [...value.slice(0, index), element, ...value.slice(index)]);
  }, []);
  const updateAt = React.useCallback((index: number, element: T) => {
    setList((value) => value.map((item, i) => (i === index ? element : item)));
  }, []);
  const clear = React.useCallback(() => setList([]), []);
  return [list, { set, push, removeAt, insertAt, updateAt, clear }];
}
