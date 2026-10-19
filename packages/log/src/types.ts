export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

import type { JsonValue, Primitive } from "@temelj/value";

export type LogAttributeValue =
  | Primitive
  | Date
  | Temporal.Instant
  | Error
  | LogAttributeValue[]
  | { [key: string]: LogAttributeValue };

export type LogAttributes = Record<string, LogAttributeValue>;

export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: Temporal.Instant;
  attributes?: LogAttributes;
  error?: unknown;
}

export interface LogSink {
  write(record: LogRecord): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface Logger {
  log(level: LogLevel, message: string, attributes?: LogAttributes): void;
  trace(message: string, attributes?: LogAttributes): void;
  debug(message: string, attributes?: LogAttributes): void;
  info(message: string, attributes?: LogAttributes): void;
  warn(message: string, attributes?: LogAttributes): void;
  error(message: string, cause: unknown, attributes?: LogAttributes): void;
  fatal(message: string, cause: unknown, attributes?: LogAttributes): void;
  child(attributes: LogAttributes): Logger;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export type LogSinkFailureMode = "ignore" | "throw";

export interface CreateLoggerOptions {
  sink: LogSink;
  level?: LogLevel;
  now?: () => Temporal.Instant;
  attributes?: LogAttributes;
  sinkFailureMode?: LogSinkFailureMode;
}

export type FormattedLogRecord = Record<string, JsonValue>;
