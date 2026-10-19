import * as React from "react";

const subscribe = (): (() => void) => () => {};

const clientSnapshot = (): boolean => true;

const serverSnapshot = (): boolean => false;

/** Returns false during server rendering and hydration, then true on the client. */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
