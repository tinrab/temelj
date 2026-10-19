import type { Result } from "@temelj/result";

import type { AsyncResultState } from "../async/use-async-result.ts";

/** Owns async execution state independently of React's render and effect phases. */
export class AsyncResultStore<T, E> {
  private state: AsyncResultState<T, E> = {
    status: "idle",
    result: null,
    loading: false,
    error: null,
  };
  private readonly serverState = this.state;
  private readonly listeners = new Set<() => void>();
  private callId = 0;
  private active = true;

  readonly getSnapshot = (): AsyncResultState<T, E> => this.state;
  readonly getServerSnapshot = (): AsyncResultState<T, E> => this.serverState;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  activate(): void {
    this.active = true;
  }
  deactivate(): void {
    this.active = false;
    this.invalidate();
  }
  invalidate(): void {
    this.callId++;
  }

  begin(): number {
    const callId = ++this.callId;
    this.update({ ...this.state, status: "loading", loading: true, error: null });

    return callId;
  }

  settle(callId: number, result: Result<T, E>): boolean {
    if (!this.active || callId !== this.callId) return false;
    this.update(
      result.kind === "ok"
        ? { status: "success", result, loading: false, error: null }
        : { status: "error", result, loading: false, error: result.error },
    );

    return true;
  }

  readonly reset = (): void => {
    this.invalidate();
    this.update({ status: "idle", result: null, loading: false, error: null });
  };

  private update(state: AsyncResultState<T, E>): void {
    this.state = state;

    for (const listener of this.listeners) listener();
  }
}
