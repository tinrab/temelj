import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/** Loading status returned by useScript. */
export type ScriptStatus = "unknown" | "loading" | "ready" | "error";

const subscriptions = new WeakMap<
  HTMLScriptElement,
  { count: number; removeWhenUnused: boolean }
>();

function findScript(src: string): HTMLScriptElement | undefined {
  return Array.from(document.scripts).find((script) => script.getAttribute("src") === src);
}

function readStatus(src: string): ScriptStatus {
  if (!isBrowser) return "loading";
  const script = findScript(src);

  if (!script) return "loading";
  const status = script.getAttribute("data-status");

  return status === "loading" || status === "ready" || status === "error" ? status : "unknown";
}

/** Loads a shared script and observes load/error events until the last subscriber detaches. */
export function useScript(src: string, options: { removeOnUnmount?: boolean } = {}): ScriptStatus {
  const removeOnUnmount = options.removeOnUnmount === true;

  const subscribe = React.useCallback(
    (callback: () => void) => {
      if (!isBrowser) return () => {};

      let script = findScript(src);

      if (!script) {
        script = document.createElement("script");
        script.setAttribute("src", src);
        script.async = true;
        script.setAttribute("data-status", "loading");
        document.body.appendChild(script);
      }

      const element = script;
      const subscription = subscriptions.get(element) ?? { count: 0, removeWhenUnused: false };
      subscription.count++;
      subscription.removeWhenUnused ||= removeOnUnmount;
      subscriptions.set(element, subscription);

      const handleLoad = () => {
        element.setAttribute("data-status", "ready");
        callback();
      };

      const handleError = () => {
        element.setAttribute("data-status", "error");
        callback();
      };

      element.addEventListener("load", handleLoad);
      element.addEventListener("error", handleError);

      return () => {
        element.removeEventListener("load", handleLoad);
        element.removeEventListener("error", handleError);
        subscription.count--;

        if (subscription.count === 0) {
          subscriptions.delete(element);

          if (subscription.removeWhenUnused) element.remove();
        }
      };
    },
    [src, removeOnUnmount],
  );

  const getSnapshot = React.useCallback(() => readStatus(src), [src]);

  return React.useSyncExternalStore(subscribe, getSnapshot, () => "loading");
}
