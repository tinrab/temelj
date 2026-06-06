import { useEventListener } from "./use-event-listener.ts";

/**
 * Attaches a typed event listener to document.
 */
export function useDocumentEvent<K extends keyof DocumentEventMap>(
  eventName: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  useEventListener(
    typeof document === "undefined" ? undefined : document,
    eventName,
    handler,
    options,
  );
}
