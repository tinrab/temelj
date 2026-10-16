/** Returns a duration's total milliseconds, or NaN when Temporal cannot represent it safely. */
export function durationTotal(value: Temporal.Duration): number {
  const total = value.total({ unit: "millisecond" });

  return Number.isFinite(total) ? total : Number.NaN;
}

/** Returns a non-negative millisecond duration between two instants. */
function durationBetweenMilliseconds(from: Temporal.Instant, to: Temporal.Instant): number {
  return Math.max(0, to.epochMilliseconds - from.epochMilliseconds);
}

/** Returns a non-negative millisecond duration between optional instants. */
export function optionalDurationBetweenMilliseconds(
  from: Temporal.Instant | undefined,
  to: Temporal.Instant | undefined,
): number | undefined {
  if (from === undefined || to === undefined) {
    return undefined;
  }

  return durationBetweenMilliseconds(from, to);
}

/** Returns a non-negative Temporal duration between two instants. */
export function durationBetween(from: Temporal.Instant, to: Temporal.Instant): Temporal.Duration {
  return Temporal.Duration.from({
    milliseconds: durationBetweenMilliseconds(from, to),
  });
}

/** Returns whether a timestamp falls inside an inclusive optional instant range. */
export function matchesTimestampRange(
  timestamp: Temporal.Instant,
  from: Temporal.Instant | undefined,
  to: Temporal.Instant | undefined,
): boolean {
  if (from === undefined && to === undefined) {
    return true;
  }

  return (
    (from === undefined || Temporal.Instant.compare(timestamp, from) >= 0) &&
    (to === undefined || Temporal.Instant.compare(timestamp, to) <= 0)
  );
}

/** Returns whether an optional timestamp falls inside an inclusive optional instant range. */
export function matchesOptionalTimestampRange(
  timestamp: Temporal.Instant | undefined,
  from: Temporal.Instant | undefined,
  to: Temporal.Instant | undefined,
): boolean {
  if (from === undefined && to === undefined) {
    return true;
  }

  if (timestamp === undefined) {
    return false;
  }

  return matchesTimestampRange(timestamp, from, to);
}

/** Returns whether an optional duration falls inside an inclusive optional duration range. */
export function matchesOptionalDurationRange(
  value: Temporal.Duration | undefined,
  from: Temporal.Duration | undefined,
  to: Temporal.Duration | undefined,
): boolean {
  if (from === undefined && to === undefined) {
    return true;
  }

  if (value === undefined) {
    return false;
  }

  const current = value.total({ unit: "millisecond" });
  const lower = from?.total({ unit: "millisecond" });
  const upper = to?.total({ unit: "millisecond" });

  return (lower === undefined || current >= lower) && (upper === undefined || current <= upper);
}

/** Compares optional timestamps, sorting present timestamps before undefined values. */
export function compareOptionalTimestamps(
  left: Temporal.Instant | undefined,
  right: Temporal.Instant | undefined,
): number {
  if (left !== undefined && right !== undefined) {
    return Temporal.Instant.compare(left, right);
  }

  if (left !== undefined) {
    return -1;
  }

  if (right !== undefined) {
    return 1;
  }

  return 0;
}

export function earliestOptionalTimestamp(
  current: Temporal.Instant | undefined,
  next: Temporal.Instant | undefined,
): Temporal.Instant | undefined {
  if (next === undefined) {
    return current;
  }

  if (current === undefined) {
    return next;
  }

  return Temporal.Instant.compare(next, current) < 0 ? next : current;
}

export function latestOptionalTimestamp(
  current: Temporal.Instant | undefined,
  next: Temporal.Instant | undefined,
): Temporal.Instant | undefined {
  if (next === undefined) {
    return current;
  }

  if (current === undefined) {
    return next;
  }

  return Temporal.Instant.compare(next, current) > 0 ? next : current;
}
