import * as React from "react";

/**
 * Battery information reported by useBattery.
 */
export interface BatteryState {
  /** Whether the browser supports the API. */
  supported: boolean;
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
  const [state, setState] = React.useState<BatteryState>({
    supported: true,
    loading: true,
    level: null,
    charging: null,
    chargingTime: null,
    dischargingTime: null,
  });

  React.useEffect(() => {
    const nav = navigator as NavigatorWithBattery;
    if (!nav.getBattery) {
      setState((current) => ({ ...current, supported: false, loading: false }));
      return undefined;
    }

    let battery: BatteryManagerLike | null = null;
    const handleChange = () => {
      if (!battery) {
        return;
      }
      setState({
        supported: true,
        loading: false,
        level: battery.level,
        charging: battery.charging,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime,
      });
    };

    void nav.getBattery().then((nextBattery) => {
      battery = nextBattery;
      handleChange();
      battery.addEventListener("levelchange", handleChange);
      battery.addEventListener("chargingchange", handleChange);
      battery.addEventListener("chargingtimechange", handleChange);
      battery.addEventListener("dischargingtimechange", handleChange);
    });

    return () => {
      battery?.removeEventListener("levelchange", handleChange);
      battery?.removeEventListener("chargingchange", handleChange);
      battery?.removeEventListener("chargingtimechange", handleChange);
      battery?.removeEventListener("dischargingtimechange", handleChange);
    };
  }, []);

  return state;
}
