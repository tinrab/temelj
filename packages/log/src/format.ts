import type { FormattedLogRecord, LogRecord } from "./types.ts";

import { errorFields, toJsonSafeValue } from "./errors.ts";

const RESERVED_FORMATTED_FIELDS = new Set(["timestamp", "level", "message"]);

export function formatLogRecord(record: LogRecord): FormattedLogRecord {
  const attributes = formatAttributes(record.attributes);
  return {
    timestamp: record.timestamp.toString(),
    level: record.level,
    message: record.message,
    ...attributes,
    ...(record.error === undefined ? {} : errorFields(record.error)),
  };
}

export function formatLogRecordText(record: LogRecord): string {
  const formatted = formatLogRecord(record);
  const { timestamp, level, message, ...metadata } = formatted;
  const metadataKeys = Object.keys(metadata);
  return metadataKeys.length === 0
    ? `${String(timestamp)} ${String(level).toUpperCase()} ${String(message)}`
    : `${String(timestamp)} ${String(level).toUpperCase()} ${String(message)} ${JSON.stringify(metadata)}`;
}

function formatAttributes(attributes: LogRecord["attributes"]): FormattedLogRecord {
  if (attributes === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => !RESERVED_FORMATTED_FIELDS.has(key))
      .map(([key, value]) => [key, toJsonSafeValue(value)] as const)
      .filter((entry): entry is [string, NonNullable<unknown>] => entry[1] !== undefined),
  );
}
