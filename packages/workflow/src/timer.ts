import type { TimerDelay } from "./types/common.ts";

import { WorkflowOptionsError } from "./errors/mod.ts";
import { durationTotal, isNonNegativeSafeInteger, isPositiveSafeInteger } from "./utility.ts";

export const MAX_TIMER_DELAY = 2 ** 31 - 1;

/** Runtime timer handle returned by setTimeout. */
export type TimeoutHandle = ReturnType<typeof setTimeout>;

/** Runtime interval handle returned by setInterval. */
export type IntervalHandle = ReturnType<typeof setInterval>;

export function nonNegativeTimerDelay(
  duration: Temporal.Duration,
  label: string,
  maximumDelay: number = MAX_TIMER_DELAY,
): TimerDelay {
  const delay = durationTotal(duration);
  if (!isNonNegativeSafeInteger(delay)) {
    WorkflowOptionsError.nonNegativeDuration(label);
  }
  return {
    duration,
    clampedDelay: Math.min(delay, maximumDelay),
  };
}

export function positiveTimerDelay(
  duration: Temporal.Duration,
  label: string,
  maximumDelay: number = MAX_TIMER_DELAY,
): TimerDelay {
  const delay = durationTotal(duration);
  if (!isPositiveSafeInteger(delay)) {
    WorkflowOptionsError.positiveDuration(label);
  }
  return {
    duration,
    clampedDelay: Math.min(delay, maximumDelay),
  };
}

export async function sleep(duration: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, Math.min(duration, MAX_TIMER_DELAY));
  });
}
