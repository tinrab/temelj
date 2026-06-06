import * as React from "react";

import { useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Returns a stable ref whose current value is updated after each render.
 */
export function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
