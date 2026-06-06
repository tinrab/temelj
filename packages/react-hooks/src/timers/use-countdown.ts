import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Tick interval and callbacks for useCountdown.
 */
export interface CountdownOptions {
  /** Tick interval in milliseconds. */
  interval?: number;
  /** Called on each countdown update. */
  onTick?: (remaining: number) => void;
  /** Called when the countdown reaches zero. */
  onComplete?: () => void;
}

/**
 * Returns remaining milliseconds until an end time and emits tick/complete callbacks.
 */
export function useCountdown(endTime: Date | number, options: CountdownOptions = {}): number {
  const { interval = 1000, onTick, onComplete } = options;
  const end = typeof endTime === "number" ? endTime : endTime.getTime();
  const [remaining, setRemaining] = React.useState(() => Math.max(0, end - Date.now()));
  const completeRef = React.useRef(false);
  const onTickRef = useLatest(onTick);
  const onCompleteRef = useLatest(onComplete);

  React.useEffect(() => {
    completeRef.current = false;
    const update = () => {
      const next = Math.max(0, end - Date.now());
      setRemaining(next);
      onTickRef.current?.(next);
      if (next === 0 && !completeRef.current) {
        completeRef.current = true;
        onCompleteRef.current?.();
      }
    };

    update();
    const id = setInterval(update, interval);
    return () => clearInterval(id);
  }, [end, interval, onTickRef, onCompleteRef]);

  return remaining;
}
