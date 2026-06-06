import * as React from "react";

import { isBrowser } from "../internal/mod.ts";
import { useLatestRef } from "../state/use-latest-ref.ts";

/**
 * Registers a beforeunload prompt while enabled.
 */
export function useBeforeUnload(enabled: boolean, message = ""): void {
  const messageRef = useLatestRef(message);

  React.useEffect(() => {
    if (!enabled || !isBrowser) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = messageRef.current;
      return messageRef.current;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled, messageRef]);
}
