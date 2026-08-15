import { expect, expectTypeOf, test } from "vitest";

import { formatByteSize, getByteSize, type ByteSize, type ByteSizeOptions } from "./mod";

test("get a localized value and unit", () => {
  expect(getByteSize(1580, { locale: "en-US" })).toEqual({ value: "1.6", unit: "kB" });
  expect(getByteSize(1580, { locale: "en-US", units: "iec" })).toEqual({
    value: "1.5",
    unit: "KiB",
  });
});

test("format bytes with metric units by default", () => {
  expect(formatByteSize(0, { locale: "en-US" })).toBe("0 B");
  expect(formatByteSize(999, { locale: "en-US" })).toBe("999 B");
  expect(formatByteSize(1000, { locale: "en-US" })).toBe("1 kB");
  expect(formatByteSize(1580, { locale: "en-US" })).toBe("1.6 kB");
  expect(formatByteSize(1_000_000, { locale: "en-US" })).toBe("1 MB");
  expect(formatByteSize(1e24, { locale: "en-US" })).toBe("1 YB");
});

test("format bytes with IEC units", () => {
  expect(formatByteSize(1023, { locale: "en-US", units: "iec" })).toBe("1,023 B");
  expect(formatByteSize(1024, { locale: "en-US", units: "iec" })).toBe("1 KiB");
  expect(formatByteSize(1580, { locale: "en-US", units: "iec" })).toBe("1.5 KiB");
  expect(formatByteSize(1024 ** 2, { locale: "en-US", units: "iec" })).toBe("1 MiB");
  expect(formatByteSize(1024 ** 8, { locale: "en-US", units: "iec" })).toBe("1 YiB");
});

test("respect precision and locale", () => {
  expect(formatByteSize(1580, { locale: "en-US", precision: 3, units: "iec" })).toBe("1.543 KiB");
  expect(formatByteSize(1580, { locale: "en-US", precision: 0, units: "iec" })).toBe("2 KiB");
  expect(formatByteSize(12_400_000, { locale: "de-DE" })).toBe("12,4 MB");
});

test("format negative values and negative zero", () => {
  expect(formatByteSize(-1580, { locale: "en-US" })).toBe("-1.6 kB");
  expect(formatByteSize(-0, { locale: "en-US" })).toBe("0 B");
});

test("keep values beyond the largest named unit in that unit", () => {
  expect(formatByteSize(1e30, { locale: "en-US" })).toBe("1,000,000 YB");
});

test("reject non-finite byte counts and invalid precision", () => {
  expect(() => getByteSize(Number.NaN)).toThrowError(new RangeError("Byte count must be finite"));
  expect(() => getByteSize(Number.POSITIVE_INFINITY)).toThrowError(
    new RangeError("Byte count must be finite"),
  );
  expect(() => getByteSize(1000, { precision: -1 })).toThrowError(
    new RangeError("Byte precision must be a non-negative safe integer"),
  );
  expect(() => getByteSize(1000, { precision: 1.5 })).toThrowError(
    new RangeError("Byte precision must be a non-negative safe integer"),
  );
});

test("expose precise return types through the public contract", () => {
  expectTypeOf(getByteSize(1000)).toEqualTypeOf<ByteSize>();
  expectTypeOf(formatByteSize(1000)).toEqualTypeOf<string>();

  // @ts-expect-error Unsupported unit systems are rejected by the public type.
  const invalidOptions: ByteSizeOptions = { units: "binary" };
  expect(invalidOptions.units).toBe("binary");
});
