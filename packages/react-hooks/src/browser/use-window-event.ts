import { useEventListener } from "./use-event-listener.ts";

/**
 * Attaches a typed event listener to window.
 */
export function useWindowEvent<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  useEventListener(typeof window === "undefined" ? undefined : window, eventName, handler, options);
}
