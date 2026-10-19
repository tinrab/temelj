import { WorkflowErrorCode } from "./errors/codes.ts";
import { WorkflowOptionsError } from "./errors/mod.ts";
import { durationTotal } from "./temporal.ts";
import { isNonNegativeSafeInteger, isPositiveSafeInteger } from "./values.ts";

/** Timer delay after validation and runtime clamping. */
interface TimerDelay {
  readonly duration: Temporal.Duration;
  readonly clampedDelay: number;
}

export const MAX_TIMER_DELAY = 2 ** 31 - 1;

export type TimeoutHandle = ReturnType<typeof setTimeout>;

export type IntervalHandle = ReturnType<typeof setInterval>;

export function nonNegativeTimerDelay(
  duration: Temporal.Duration,
  label: string,
  maximumDelay: number = MAX_TIMER_DELAY,
): TimerDelay {
  const delay = durationTotal(duration);

  if (!isNonNegativeSafeInteger(delay)) {
    throw new WorkflowOptionsError(`${label} must be non-negative`, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_NON_NEGATIVE_DURATION,
      details: { label: label },
    });
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
    throw new WorkflowOptionsError(`${label} must be greater than zero`, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_POSITIVE_DURATION,
      details: { label: label },
    });
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
