import * as React from "react";

import { isBrowser, useLatest } from "../internal/mod.ts";

/**
 * Loading status returned by useScript.
 */
export type ScriptStatus = "unknown" | "loading" | "ready" | "error";

/**
 * Loads a script element and tracks its loading status.
 */
export function useScript(src: string, options: { removeOnUnmount?: boolean } = {}): ScriptStatus {
  const [status, setStatus] = React.useState<ScriptStatus>("loading");
  const optionsRef = useLatest(options);

  React.useEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const existingStatus = script?.getAttribute("data-status") as ScriptStatus | null;
    if (existingStatus) {
      setStatus(existingStatus);
      return undefined;
    }

    if (!script) {
      const removeOnUnmount = optionsRef.current.removeOnUnmount;
      script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.setAttribute("data-status", "loading");
      document.body.appendChild(script);

      const handleLoad = () => {
        script?.setAttribute("data-status", "ready");
        setStatus("ready");
      };
      const handleError = () => {
        script?.setAttribute("data-status", "error");
        setStatus("error");
      };

      script.addEventListener("load", handleLoad);
      script.addEventListener("error", handleError);
      return () => {
        script?.removeEventListener("load", handleLoad);
        script?.removeEventListener("error", handleError);
        if (removeOnUnmount) script?.remove();
      };
    }

    setStatus("unknown");
    return undefined;
  }, [src, optionsRef]);

  return status;
}
