import * as React from "react";

import { isBrowser } from "../internal/mod.ts";
import { BrowserHookError } from "./errors.ts";

/**
 * Geolocation coordinates, timestamp, loading state, and error information.
 */
export interface GeolocationState {
  /** Whether an operation is currently in flight. */
  loading: boolean;
  /** Coordinate accuracy in meters. */
  accuracy: number | null;
  /** Altitude in meters, when available. */
  altitude: number | null;
  /** Altitude accuracy in meters, when available. */
  altitudeAccuracy: number | null;
  /** Heading in degrees, when available. */
  heading: number | null;
  /** Latitude in decimal degrees. */
  latitude: number | null;
  /** Longitude in decimal degrees. */
  longitude: number | null;
  /** Speed in meters per second, when available. */
  speed: number | null;
  /** Timestamp for the reported value. */
  timestamp: number | null;
  /** Latest error value, or null when there is no error. */
  error: GeolocationPositionError | Error | null;
}

const defaultGeolocationState: GeolocationState = {
  /** Whether an operation is currently in flight. */
  loading: true,
  /** Coordinate accuracy in meters. */
  accuracy: null,
  /** Altitude in meters, when available. */
  altitude: null,
  /** Altitude accuracy in meters, when available. */
  altitudeAccuracy: null,
  /** Heading in degrees, when available. */
  heading: null,
  /** Latitude in decimal degrees. */
  latitude: null,
  /** Longitude in decimal degrees. */
  longitude: null,
  /** Speed in meters per second, when available. */
  speed: null,
  /** Timestamp for the reported value. */
  timestamp: null,
  /** Latest error value, or null when there is no error. */
  error: null,
};

/**
 * Subscribes to the browser geolocation position and returns the latest coordinates.
 */
export function useGeolocation(options: PositionOptions = {}): GeolocationState {
  const [state, setState] = React.useState(() =>
    isBrowser && navigator.geolocation
      ? defaultGeolocationState
      : {
          ...defaultGeolocationState,
          loading: false,
          error: BrowserHookError.createGeolocationUnsupported(),
        },
  );

  const { enableHighAccuracy, maximumAge, timeout } = options;

  React.useEffect(() => {
    if (!isBrowser || !navigator.geolocation) {
      return undefined;
    }

    let active = true;

    const onSuccess = ({ coords, timestamp }: GeolocationPosition) => {
      if (!active) return;
      setState({
        loading: false,
        timestamp,
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude,
        accuracy: coords.accuracy,
        altitudeAccuracy: coords.altitudeAccuracy,
        heading: coords.heading,
        speed: coords.speed,
        error: null,
      });
    };

    const onError = (error: GeolocationPositionError) => {
      if (!active) return;
      setState((current) => ({ ...current, loading: false, error }));
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy,
      maximumAge,
      timeout,
    });

    const watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy,
      maximumAge,
      timeout,
    });

    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enableHighAccuracy, maximumAge, timeout]);

  return state;
}
