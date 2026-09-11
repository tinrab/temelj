import * as React from "react";

import { thrownError } from "../internal/error.ts";

/**
 * Battery information reported by useBattery.
 */
export interface BatteryState {
  /** Whether the browser supports the API. */
  supported: boolean;
  /** Latest failure to read battery information. */
  error: Error | null;
  /** Whether an operation is currently in flight. */
  loading: boolean;
  /** Battery charge level from 0 to 1. */
  level: number | null;
  /** Whether the battery is charging. */
  charging: boolean | null;
  /** Seconds until full charge. */
  chargingTime: number | null;
  /** Seconds until discharge. */
  dischargingTime: number | null;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

interface BatteryManagerLike extends EventTarget {
  /** Battery charge level from 0 to 1. */
  level: number;
  /** Whether the battery is charging. */
  charging: boolean;
  /** Seconds until full charge. */
  chargingTime: number;
  /** Seconds until discharge. */
  dischargingTime: number;
}

/**
 * Tracks browser Battery Status API values when the API is available.
 */
export function useBattery(): BatteryState {
  const [state, setState] = React.useState<BatteryState>(() => ({
    supported: typeof navigator !== "undefined" && "getBattery" in navigator,
    loading: typeof navigator !== "undefined" && "getBattery" in navigator,
    error: null,
    level: null,
    charging: null,
    chargingTime: null,
    dischargingTime: null,
  }));

  React.useEffect(() => {
    if (typeof navigator === "undefined") return undefined;
    const nav: NavigatorWithBattery = navigator;

    if (!nav.getBattery) {
      return undefined;
    }

    let cancelled = false;
    let battery: BatteryManagerLike | null = null;

    const handleChange = () => {
      if (!battery) {
        return;
      }

      setState({
        supported: true,
        error: null,
        loading: false,
        level: battery.level,
        charging: battery.charging,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime,
      });
    };

    void nav
      .getBattery()
      .then((nextBattery) => {
        if (cancelled) return;
        battery = nextBattery;
        handleChange();
        battery.addEventListener("levelchange", handleChange);
        battery.addEventListener("chargingchange", handleChange);
        battery.addEventListener("chargingtimechange", handleChange);
        battery.addEventListener("dischargingtimechange", handleChange);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setState((current) => ({ ...current, loading: false, error: thrownError(cause) }));
      });

    return () => {
      cancelled = true;
      battery?.removeEventListener("levelchange", handleChange);
      battery?.removeEventListener("chargingchange", handleChange);
      battery?.removeEventListener("chargingtimechange", handleChange);
      battery?.removeEventListener("dischargingtimechange", handleChange);
    };
  }, []);

  return state;
}
