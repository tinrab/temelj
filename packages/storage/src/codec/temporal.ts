import SuperJSON from "superjson";

const registeredSuperJSONInstances = new WeakSet<object>();

/** Registers Temporal serializers on a SuperJSON-compatible instance once per instance. */
export function registerTemporalStorageSerialization(
  superjson: Pick<typeof SuperJSON, "registerCustom"> = SuperJSON,
): void {
  if (registeredSuperJSONInstances.has(superjson)) {
    return;
  }
  registeredSuperJSONInstances.add(superjson);

  superjson.registerCustom<Temporal.ZonedDateTime, string>(
    {
      isApplicable: (value): value is Temporal.ZonedDateTime =>
        value instanceof Temporal.ZonedDateTime,
      serialize: (value) => value.toJSON(),
      deserialize: (raw) => Temporal.ZonedDateTime.from(raw),
    },
    "Temporal.ZonedDateTime",
  );
  superjson.registerCustom<Temporal.PlainTime, string>(
    {
      isApplicable: (value): value is Temporal.PlainTime => value instanceof Temporal.PlainTime,
      serialize: (value) => value.toJSON(),
      deserialize: (raw) => Temporal.PlainTime.from(raw),
    },
    "Temporal.PlainTime",
  );
  superjson.registerCustom<Temporal.PlainMonthDay, string>(
    {
      isApplicable: (value): value is Temporal.PlainMonthDay =>
        value instanceof Temporal.PlainMonthDay,
      serialize: (value) => value.toJSON(),
      deserialize: (raw) => Temporal.PlainMonthDay.from(raw),
    },
    "Temporal.PlainMonthDay",
  );
  superjson.registerCustom<Temporal.PlainYearMonth, string>(
    {
      isApplicable: (value): value is Temporal.PlainYearMonth =>
        value instanceof Temporal.PlainYearMonth,
      serialize: (value) => value.toJSON(),
      deserialize: (raw) => Temporal.PlainYearMonth.from(raw),
    },
    "Temporal.PlainYearMonth",
  );
  superjson.registerCustom<Temporal.PlainDate, string>(
    {
      isApplicable: (value): value is Temporal.PlainDate => value instanceof Temporal.PlainDate,
      serialize: (value) => value.toJSON(),
      deserialize: (raw) => Temporal.PlainDate.from(raw),
    },
    "Temporal.PlainDate",
  );
  superjson.registerCustom<Temporal.PlainDateTime, string>(
    {
      isApplicable: (value): value is Temporal.PlainDateTime =>
        value instanceof Temporal.PlainDateTime,
      serialize: (value) => value.toJSON(),
      deserialize: (raw) => Temporal.PlainDateTime.from(raw),
    },
    "Temporal.PlainDateTime",
  );
  superjson.registerCustom<Temporal.Duration, string>(
    {
      isApplicable: (value): value is Temporal.Duration => value instanceof Temporal.Duration,
      serialize: (value) => value.toJSON(),
      deserialize: (raw) => Temporal.Duration.from(raw),
    },
    "Temporal.Duration",
  );
  superjson.registerCustom<Temporal.Instant, string>(
    {
      isApplicable: (value): value is Temporal.Instant => value instanceof Temporal.Instant,
      serialize: (value) => value.toJSON(),
      deserialize: (raw) => Temporal.Instant.from(raw),
    },
    "Temporal.Instant",
  );
}

export function isTemporalStorageValue(value: unknown): value is StorageTemporalValue {
  return (
    value instanceof Temporal.Instant ||
    value instanceof Temporal.Duration ||
    value instanceof Temporal.ZonedDateTime ||
    value instanceof Temporal.PlainDateTime ||
    value instanceof Temporal.PlainDate ||
    value instanceof Temporal.PlainTime ||
    value instanceof Temporal.PlainYearMonth ||
    value instanceof Temporal.PlainMonthDay
  );
}

export type StorageTemporalValue =
  | Temporal.Instant
  | Temporal.Duration
  | Temporal.ZonedDateTime
  | Temporal.PlainDateTime
  | Temporal.PlainDate
  | Temporal.PlainTime
  | Temporal.PlainYearMonth
  | Temporal.PlainMonthDay;
