import { recordEquals } from "@temelj/value";
import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

interface NavigatorConnection extends EventTarget {
  /** Estimated downlink speed in megabits per second. */
  downlink?: number;
  /** Maximum downlink speed when available. */
  downlinkMax?: number;
  /** Effective network connection type. */
  effectiveType?: string;
  /** Estimated round-trip time in milliseconds. */
  rtt?: number;
  /** Whether data saver is enabled. */
  saveData?: boolean;
  /** Network connection type when available. */
  type?: string;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NavigatorConnection;
  mozConnection?: NavigatorConnection;
  webkitConnection?: NavigatorConnection;
}

/**
 * Network connection information reported by useNetworkState.
 */
export interface NetworkState {
  /** Whether the browser is online. */
  online: boolean;
  /** Estimated downlink speed in megabits per second. */
  downlink: number | null;
  /** Maximum downlink speed when available. */
  downlinkMax: number | null;
  /** Effective network connection type. */
  effectiveType: string | null;
  /** Estimated round-trip time in milliseconds. */
  rtt: number | null;
  /** Whether data saver is enabled. */
  saveData: boolean | null;
  /** Network connection type when available. */
  type: string | null;
}

const defaultNetworkState: NetworkState = {
  /** Whether the browser is online. */
  online: true,
  /** Estimated downlink speed in megabits per second. */
  downlink: null,
  /** Maximum downlink speed when available. */
  downlinkMax: null,
  /** Effective network connection type. */
  effectiveType: null,
  /** Estimated round-trip time in milliseconds. */
  rtt: null,
  /** Whether data saver is enabled. */
  saveData: null,
  /** Network connection type when available. */
  type: null,
};

function getConnection(): NavigatorConnection | undefined {
  const nav = navigator as NavigatorWithConnection;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

/**
 * Subscribes to online/offline and Network Information API changes.
 */
export function useNetworkState(): NetworkState {
  const cache = React.useRef<NetworkState>(defaultNetworkState);
  const subscribe = React.useCallback((callback: () => void) => {
    if (!isBrowser) {
      return () => {};
    }
    window.addEventListener("online", callback, { passive: true });
    window.addEventListener("offline", callback, { passive: true });
    const connection = getConnection();
    connection?.addEventListener("change", callback);
    return () => {
      window.removeEventListener("online", callback);
      window.removeEventListener("offline", callback);
      connection?.removeEventListener("change", callback);
    };
  }, []);
  const getSnapshot = React.useCallback(() => {
    if (!isBrowser) return defaultNetworkState;
    const connection = getConnection();
    const next: NetworkState = {
      online: navigator.onLine,
      downlink: connection?.downlink ?? null,
      downlinkMax: connection?.downlinkMax ?? null,
      effectiveType: connection?.effectiveType ?? null,
      rtt: connection?.rtt ?? null,
      saveData: connection?.saveData ?? null,
      type: connection?.type ?? null,
    };
    if (
      recordEquals(
        cache.current as unknown as Record<string, unknown>,
        next as unknown as Record<string, unknown>,
        Object.is,
      )
    ) {
      return cache.current;
    }
    cache.current = next;
    return next;
  }, []);
  return React.useSyncExternalStore(subscribe, getSnapshot, () => defaultNetworkState);
}
