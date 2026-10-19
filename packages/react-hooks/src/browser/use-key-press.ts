import type * as ReactTypes from "react";

import * as React from "react";

import { getDefaultTarget, useLatest } from "../internal/mod.ts";

type EventTargetLike<T extends EventTarget = EventTarget> =
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

function useEventListener(
  /** Target to attach the listener to. */
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
  }, [eventName, handlerRef, options, target]);
}

/**
 * Event target and listener options for useKeyPress.
 */
export interface KeyPressOptions {
  /** Keyboard event type to listen for. */
  event?: "keydown" | "keyup" | "keypress";
  /** Target to attach the listener to. */
  target?: EventTargetLike<Window | Document | HTMLElement>;
  /** Options passed to addEventListener. */
  eventOptions?: AddEventListenerOptions;
}

/**
 * Calls a callback when the configured keyboard event matches a key.
 */
export function useKeyPress(
  key: string,
  callback: (event: KeyboardEvent) => void,
  options: KeyPressOptions = {},
): void {
  const { event = "keydown", target = getDefaultTarget(), eventOptions } = options;
  useEventListener(
    target,
    event,
    (keyboardEvent) => {
      if (keyboardEvent instanceof KeyboardEvent && keyboardEvent.key === key) {
        callback(keyboardEvent);
      }
    },
    eventOptions,
  );
}
