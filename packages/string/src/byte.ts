const BYTE_UNITS = {
  metric: ["B", "kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
  iec: ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"],
} as const;

/** Unit system used to format a byte count. */
export type ByteUnitSystem = keyof typeof BYTE_UNITS;

/** Abbreviated unit used in a byte size. */
export type ByteUnit = (typeof BYTE_UNITS)[ByteUnitSystem][number];

/** A localized byte value and its abbreviated unit. */
export interface ByteSize {
  value: string;
  unit: ByteUnit;
}

/** Options for calculating a byte size. */
export interface ByteSizeOptions {
  /** Unit system to use. Defaults to metric (powers of 1000). */
  units?: ByteUnitSystem;

  /** Maximum number of fractional digits. Defaults to 1. */
  precision?: number;

  /** Locale or locales passed to `Intl.NumberFormat`. */
  locale?: Intl.LocalesArgument;
}

/**
 * Calculates a localized, human-readable byte value and unit.
 *
 * Values beyond the largest unit remain expressed in yottabytes or yobibytes.
 *
 * @param bytes Byte count to format. Negative values are supported.
 * @param options Formatting options.
 * @returns The localized value and abbreviated unit.
 * @throws {RangeError} If `bytes` is not finite or `precision` is not a non-negative integer.
 */
export function getByteSize(bytes: number, options: ByteSizeOptions = {}): ByteSize {
  if (!Number.isFinite(bytes)) {
    throw new RangeError("Byte count must be finite");
  }

  const precision = options.precision ?? 1;
  if (!Number.isSafeInteger(precision) || precision < 0) {
    throw new RangeError("Byte precision must be a non-negative safe integer");
  }

  const units = options.units ?? "metric";
  const base = units === "metric" ? 1000 : 1024;
  const unitNames = BYTE_UNITS[units];
  const magnitude = Math.abs(bytes);
  let value = magnitude;
  let unitIndex = 0;

  while (value >= base && unitIndex < unitNames.length - 1) {
    value /= base;
    unitIndex++;
  }

  if (bytes < 0) {
    value = -value;
  }

  const formattedValue = new Intl.NumberFormat(options.locale, {
    maximumFractionDigits: precision,
  }).format(value);

  return { value: formattedValue, unit: unitNames[unitIndex] };
}

/**
 * Formats a byte count as a localized, human-readable string.
 *
 * @param bytes Byte count to format. Negative values are supported.
 * @param options Formatting options.
 * @returns The formatted value and abbreviated unit, separated by a space.
 * @throws {RangeError} If `bytes` is not finite or `precision` is not a non-negative integer.
 */
export function formatByteSize(bytes: number, options: ByteSizeOptions = {}): string {
  const { value, unit } = getByteSize(bytes, options);
  return `${value} ${unit}`;
}
