import { WorkflowOptionsError } from "./errors/base.ts";
import { WorkflowErrorCode } from "./errors/codes.ts";
import { WorkflowDurationError } from "./errors/failures.ts";

/** Returns the greatest positive safe integer from two optional values. */
export function greatestOptionalNumber(
  current: number | undefined,
  next: number | undefined,
): number | undefined {
  if (next === undefined || !isPositiveSafeInteger(next)) {
    return current;
  }

  if (current === undefined) {
    return next;
  }

  return Math.max(current, next);
}

export function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Returns the next positive safe integer, or undefined when the input cannot be advanced. */
export function nextPositiveSafeInteger(value: number): number | undefined {
  return isPositiveSafeInteger(value) && value < Number.MAX_SAFE_INTEGER ? value + 1 : undefined;
}

export function isAbortError(cause: unknown): boolean {
  return (
    (cause instanceof Error && cause.name === "AbortError") ||
    (cause instanceof DOMException && cause.name === "AbortError")
  );
}

export function positiveSafeInteger(value: number, label: string): number {
  if (!isPositiveSafeInteger(value)) {
    throw new WorkflowDurationError(`${label} must be a positive safe integer`);
  }

  return value;
}

export function resolvePositiveSafeIntegerOption(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPositiveSafeInteger(value)) {
    WorkflowOptionsError.positiveSafeInteger(label);
  }

  return value;
}

export function safeDuration(value: number, label: string): number {
  try {
    resolveSafeRetryDelay(value, label);
  } catch (error) {
    if (!(error instanceof WorkflowOptionsError)) {
      throw error;
    }

    throw new WorkflowDurationError(`${label} must be a timer-safe duration`);
  }

  return value;
}

export function durationAmount(value: Temporal.Duration, label: string): number {
  if (!(value instanceof Temporal.Duration)) {
    throw new WorkflowDurationError(`${label} must be a Temporal.Duration`);
  }

  const amount = value.total({ unit: "millisecond" });

  if (!Number.isFinite(amount)) {
    throw new WorkflowDurationError(`${label} must be finite`);
  }

  return amount;
}

/** Returns a retry delay in milliseconds and reports invalid numbers as duration errors. */
export function resolveSafeRetryDelay(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value !== undefined && !Number.isSafeInteger(value)) {
    throw new WorkflowOptionsError(`${label} must be a timer-safe duration`, {
      code: WorkflowErrorCode.OPTIONS_EXPECTED_TIMER_SAFE_DURATION,
      details: { label: label },
    });
  }

  return value;
}
