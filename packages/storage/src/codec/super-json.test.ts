import { describe, expect, test } from "vitest";

import { createSuperJsonStorageCodec } from "./super-json.ts";
import { isTemporalStorageValue } from "./temporal.ts";

describe("createSuperJsonStorageCodec()", () => {
  test.each([
    ["instant", Temporal.Instant.from("2025-01-01T10:00:00Z")],
    ["duration", Temporal.Duration.from({ minutes: 5 })],
    ["plain date time", Temporal.PlainDateTime.from("2025-01-01T10:00:00")],
    ["plain date", Temporal.PlainDate.from("2025-01-01")],
    ["plain time", Temporal.PlainTime.from("10:00:00")],
    ["plain year month", Temporal.PlainYearMonth.from("2026-06")],
    ["plain month day", Temporal.PlainMonthDay.from("06-16")],
  ])("round-trips Temporal %s values", (_name, value) => {
    const codec = createSuperJsonStorageCodec();
    const decoded = codec.decode(codec.encode(value));

    expect(isTemporalStorageValue(decoded)).toBe(true);
    expect(decoded).toEqual(value);
  });
});
