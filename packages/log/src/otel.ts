import { context, trace, type AttributeValue } from "@opentelemetry/api";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";

import type { LogSink } from "./types.ts";
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

function toOpenTelemetryAttributes(
  attributes: Record<string, unknown>,
): Record<string, AttributeValue> {
  return Object.fromEntries(
    Object.entries(attributes)
      .map(([key, value]) => [key, toOpenTelemetryAttributeValue(value)] as const)
      .filter((entry): entry is [string, AttributeValue] => entry[1] !== undefined),
  );
}

function toOpenTelemetryAttributeValue(value: unknown): AttributeValue | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value)
  ) {
    return isAttributeValue(value) ? value : JSON.stringify(value);
  }
  if (value === undefined) {
    return undefined;
  }
  return JSON.stringify(value);
}

// TODO: use @temelj/value?
function isAttributeValue(value: unknown): value is AttributeValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(
    (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
  );
}
