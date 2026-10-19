import * as React from "react";

/** Controls for a cancellable operation. */
export interface AbortControllerControls {
  /** Current AbortController instance. */
  controller: AbortController;
  /** Current AbortSignal from the controller. */
  signal: AbortSignal;
  /** Whether the current signal has been aborted. */
  aborted: boolean;
  /** Aborts the current controller with an optional error or message. */
  abort: (reason?: Error | string) => void;
  /** Aborts the previous controller and replaces it with a fresh one. */
  reset: () => AbortController;
}

type ControllerState = Pick<AbortControllerControls, "controller" | "signal" | "aborted">;

class ControllerStore {
  #state: ControllerState;
  #listeners = new Set<() => void>();

  constructor() {
    this.#state = this.create();
  }

  getSnapshot = (): ControllerState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  abort = (reason?: Error | string): void => {
    this.#state.controller.abort(reason);
  };

  reset = (): AbortController => {
    this.abort();
    this.#state = this.create();
    this.notify();

    return this.#state.controller;
  };

  activate(): void {
    if (this.#state.aborted) this.reset();
  }

  private create(): ControllerState {
    const controller = new AbortController();
    controller.signal.addEventListener(
      "abort",
      () => {
        this.#state = { controller, signal: controller.signal, aborted: true };
        this.notify();
      },
      { once: true },
    );

    return { controller, signal: controller.signal, aborted: false };
  }

  private notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** Manages an AbortController lifecycle, including external aborts and Strict Mode remounts. */
export function useAbortController(): AbortControllerControls {
  const [store] = React.useState(() => new ControllerStore());
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  React.useEffect(() => {
    store.activate();

    return () => store.abort();
  }, [store]);

  return { ...state, abort: store.abort, reset: store.reset };
}
