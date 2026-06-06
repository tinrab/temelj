import type { Result } from "@temelj/result";

import { err, ok } from "@temelj/result";
import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  // TODO: deprecated
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

/**
 * State and controls returned by useClipboardResult.
 */
export interface ClipboardResultState<E = unknown> {
  /** Last copied value, or null before the first successful copy. */
  value: string | null;
  /** Latest copy Result, or null before the first attempt. */
  result: Result<void, E> | null;
  /** Latest error value, or null when there is no error. */
  error: E | null;
  /** Whether a copy operation is currently running. */
  copying: boolean;
  /** Copies text to the clipboard and returns a Result. */
  copy: (value: string) => Promise<Result<void, E>>;
  /** Resets clipboard result state. */
  reset: () => void;
}

/**
 * Copies text to the clipboard and exposes the outcome as a Temelj Result.
 */
export function useClipboardResult<E = unknown>(
  mapError: (error: unknown) => E = (error) => error as E,
): ClipboardResultState<E> {
  const [state, setState] = React.useState<Omit<ClipboardResultState<E>, "copy" | "reset">>({
    value: null,
    result: null,
    error: null,
    copying: false,
  });

  const copy = React.useCallback(
    async (value: string): Promise<Result<void, E>> => {
      setState((current) => ({ ...current, copying: true, error: null }));
      try {
        if (!isBrowser) {
          throw new Error("Clipboard is not available outside the browser");
        }
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          fallbackCopy(value);
        }
        const result = ok<void>(undefined);
        setState({ value, result, error: null, copying: false });
        return result;
      } catch (error) {
        const mapped = mapError(error);
        const result = err(mapped);
        setState({ value: null, result, error: mapped, copying: false });
        return result;
      }
    },
    [mapError],
  );

  const reset = React.useCallback(() => {
    setState({ value: null, result: null, error: null, copying: false });
  }, []);

  return { ...state, copy, reset };
}
