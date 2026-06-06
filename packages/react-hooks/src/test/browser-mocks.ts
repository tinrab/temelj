/* oxlint-disable vitest/require-mock-type-parameters */
import { vi } from "vitest";

export interface MockMediaQueryList extends MediaQueryList {
  setMatches: (matches: boolean) => void;
}

/**
 * Installs a controllable matchMedia mock.
 */
export function mockMatchMedia(
  matchesFor: (query: string) => boolean,
): Map<string, MockMediaQueryList> {
  const lists = new Map<string, MockMediaQueryList>();

  vi.stubGlobal("matchMedia", (query: string) => {
    const existing = lists.get(query);
    if (existing) return existing;

    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const list = {
      media: query,
      matches: matchesFor(query),
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
      dispatchEvent: () => true,
      setMatches(matches: boolean) {
        Object.defineProperty(this, "matches", {
          configurable: true,
          value: matches,
        });
        const event = { matches, media: query } as MediaQueryListEvent;
        for (const listener of listeners) listener(event);
      },
    } as MockMediaQueryList;
    lists.set(query, list);
    return list;
  });

  return lists;
}

/**
 * Installs a ResizeObserver mock and returns observed callbacks.
 */
export function mockResizeObserver() {
  const callbacks: ResizeObserverCallback[] = [];

  class MockResizeObserver {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      callbacks.push(callback);
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  return callbacks;
}
