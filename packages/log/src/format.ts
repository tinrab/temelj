import type { FormattedLogRecord, LogRecord } from "./types.ts";

import { errorFields, toJsonSafeValue } from "./errors.ts";

const RESERVED_FORMATTED_FIELDS = new Set(["timestamp", "level", "message"]);

export function formatLogRecord(record: LogRecord): FormattedLogRecord {
  const formatted: FormattedLogRecord = {
    timestamp: record.timestamp.toString(),
    level: record.level,
    message: record.message,
  };

  for (const [key, value] of Object.entries(record.attributes ?? {})) {
    if (RESERVED_FORMATTED_FIELDS.has(key)) continue;
    const converted = toJsonSafeValue(value);

    if (converted !== undefined) {
      Object.defineProperty(formatted, key, {
        value: converted,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  if (record.error !== undefined) Object.assign(formatted, errorFields(record.error));

  return formatted;
}

export function formatLogRecordText(record: LogRecord): string {
  const formatted = formatLogRecord(record);
  const { timestamp, level, message, ...metadata } = formatted;
  const metadataKeys = Object.keys(metadata);

  return metadataKeys.length === 0
    ? `${String(timestamp)} ${String(level).toUpperCase()} ${String(message)}`
    : `${String(timestamp)} ${String(level).toUpperCase()} ${String(message)} ${JSON.stringify(metadata)}`;
}
