import { context, trace, type Attributes, type AttributeValue } from "@opentelemetry/api";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";
import { isString, isNumber, isBoolean, type JsonValue } from "@temelj/value";

import type { FormattedLogRecord, LogSink } from "./types.ts";
import type { LogLevel } from "./types.ts";

import { formatLogRecord } from "./format.ts";

export interface OpenTelemetryLogSinkOptions {
  attachToActiveSpan?: boolean;
  emitLogs?: boolean;
  instrumentationName?: string;
  instrumentationVersion?: string;
}

export function createOpenTelemetryLogSink(options: OpenTelemetryLogSinkOptions = {}): LogSink {
  const attachToActiveSpan = options.attachToActiveSpan ?? true;
  const emitLogs = options.emitLogs ?? false;

  const logger = emitLogs
    ? logs.getLogger(
        options.instrumentationName ?? "temelj.log",
        options.instrumentationVersion ?? "0.1.0",
      )
    : undefined;

  return {
    write: (record) => {
      const formatted = formatLogRecord(record);

      if (attachToActiveSpan) {
        const span = trace.getActiveSpan();

        if (span !== undefined) {
          span.addEvent(`log.${record.level}`, toOpenTelemetryAttributes(formatted));
        }
      }

      logger?.emit({
        attributes: toOpenTelemetryAttributes(formatted),
        body: record.message,
        context: context.active(),
        eventName: `log.${record.level}`,
        severityNumber: severityNumber(record.level),
        severityText: record.level.toUpperCase(),
        timestamp: record.timestamp.epochMilliseconds,
      });
    },
  };
}

function severityNumber(level: LogLevel): SeverityNumber {
  switch (level) {
    case "trace":
      return SeverityNumber.TRACE;
    case "debug":
      return SeverityNumber.DEBUG;
    case "info":
      return SeverityNumber.INFO;
    case "warn":
      return SeverityNumber.WARN;
    case "error":
      return SeverityNumber.ERROR;
    case "fatal":
      return SeverityNumber.FATAL;
  }
}

function toOpenTelemetryAttributes(attributes: FormattedLogRecord): Attributes {
  const result: Attributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    Object.defineProperty(result, key, {
      value: toOpenTelemetryAttributeValue(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return result;
}

function toOpenTelemetryAttributeValue(value: JsonValue): AttributeValue {
  if (isString(value) || isNumber(value) || isBoolean(value)) return value;

  if (
    Array.isArray(value) &&
    (value.every(isString) || value.every(isNumber) || value.every(isBoolean))
  )
    return value;

  return JSON.stringify(value);
}
