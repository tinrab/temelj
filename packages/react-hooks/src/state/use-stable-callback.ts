import * as React from "react";

import { useLatestRef } from "./use-latest-ref.ts";

/**
 * Returns a stable function that always calls the latest callback implementation.
 */
export function useStableCallback<Args extends unknown[], R>(
  callback: (...args: Args) => R,
): (...args: Args) => R {
  const callbackRef = useLatestRef(callback);

  return React.useCallback((...args: Args) => callbackRef.current(...args), [callbackRef]);
}
