import type * as ReactTypes from "react";

import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * DOM event target value accepted by useEventListener, including React refs.
 */
export type EventTargetLike<T extends EventTarget = EventTarget> =
  | T
  | ReactTypes.RefObject<T | null>
  | null
  | undefined;

function resolveTarget<T extends EventTarget>(target: EventTargetLike<T>): T | undefined {
  if (!target) {
    return undefined;
  }
  if ("current" in target) {
    return target.current ?? undefined;
  }
  return target;
}

/**
 * Attaches a typed DOM event listener and keeps the latest handler without resubscribing.
 */
export function useEventListener<K extends keyof WindowEventMap>(
  target: EventTargetLike<Window>,
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void;

/**
 * Attaches a typed DOM event listener and keeps the latest handler without resubscribing.
 */
export function useEventListener<K extends keyof DocumentEventMap>(
  target: EventTargetLike<Document>,
  eventName: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void;

/**
 * Attaches a typed DOM event listener and keeps the latest handler without resubscribing.
 */
export function useEventListener<K extends keyof HTMLElementEventMap, T extends HTMLElement>(
  target: EventTargetLike<T>,
  eventName: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void;

/**
 * Attaches a typed DOM event listener and keeps the latest handler without resubscribing.
 */
export function useEventListener(
  target: EventTargetLike,
  eventName: string,
  handler: (event: Event) => void,
  options?: AddEventListenerOptions,
): void {
  const handlerRef = useLatest(handler);
  React.useEffect(() => {
    const node = resolveTarget(target);
    if (!node) {
      return undefined;
    }
    const listener = (event: Event) => handlerRef.current(event);
    node.addEventListener(eventName, listener, options);
    return () => node.removeEventListener(eventName, listener, options);
  });
}
