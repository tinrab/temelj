import * as React from "react";

/**
 * Controls returned by useAbortController.
 */
export interface AbortControllerControls {
  /** Current AbortController instance. */
  controller: AbortController;
  /** Current AbortSignal from the controller. */
  signal: AbortSignal;
  /** Whether the current signal has been aborted. */
  aborted: boolean;
  /** Aborts the current controller. */
  abort: (reason?: unknown) => void;
  /** Replaces the current controller with a fresh one. */
  reset: () => AbortController;
}

/**
 * Manages an AbortController lifecycle for cancellable async work.
 */
export function useAbortController(): AbortControllerControls {
  const [controller, setController] = React.useState(() => new AbortController());
  const [aborted, setAborted] = React.useState(controller.signal.aborted);
  const controllerRef = React.useRef(controller);
  controllerRef.current = controller;

  React.useEffect(() => {
    const signal = controller.signal;
    setAborted(signal.aborted);
    const handleAbort = () => setAborted(true);
    signal.addEventListener("abort", handleAbort);
    return () => signal.removeEventListener("abort", handleAbort);
  }, [controller]);

  React.useEffect(() => () => controllerRef.current.abort(), []);

  const abort = React.useCallback((reason?: unknown) => {
    controllerRef.current.abort(reason);
    setAborted(true);
  }, []);

  const reset = React.useCallback(() => {
    const next = new AbortController();
    controllerRef.current = next;
    setController(next);
    setAborted(false);
    return next;
  }, []);

  return { controller, signal: controller.signal, aborted, abort, reset };
}
