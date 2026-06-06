import * as React from "react";

function useRenderCount(): number {
  const count = React.useRef(0);
  count.current++;
  return count.current;
}

/**
 * Development-only render diagnostic information.
 */
export interface RenderInfo {
  /** Diagnostic label. */
  name: string;
  /** Number of renders observed. */
  renders: number;
  /** Milliseconds since the previous render. */
  sinceLastRender: number;
  /** Timestamp for the reported value. */
  timestamp: number;
}

/**
 * Logs and returns render diagnostics in non-production environments.
 */
export function useRenderInfo(name = "Unknown"): RenderInfo | undefined {
  const renders = useRenderCount();
  const lastRender = React.useRef<number | undefined>(undefined);
  const timestamp = Date.now();
  const sinceLastRender = lastRender.current === undefined ? 0 : timestamp - lastRender.current;

  React.useEffect(() => {
    lastRender.current = Date.now();
  });

  const isProduction = typeof process !== "undefined" && process.env?.NODE_ENV === "production";
  if (isProduction) {
    return undefined;
  }
  const info = { name, renders, sinceLastRender, timestamp };
  console.log(info);
  return info;
}
