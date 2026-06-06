import type { Result } from "@temelj/result";

import { err, ok } from "@temelj/result";

import { type NetworkState, useNetworkState } from "./use-network-state.ts";

/**
 * Error returned by useOnlineResult when the browser is offline.
 */
export interface OfflineError {
  /** Stable offline error code. */
  code: "offline";
  /** Human-readable offline message. */
  message: string;
}

/**
 * Returns network state as a Result, using Err when the browser is offline.
 */
export function useOnlineResult(): Result<NetworkState, OfflineError> {
  const network = useNetworkState();
  if (network.online) {
    return ok(network);
  }
  return err({ code: "offline", message: "Browser is offline" });
}
