import type { LogRecord, LogSink } from "./types.ts";

import { formatLogRecord, formatLogRecordText } from "./format.ts";

export interface ConsoleLogWriter {
  readonly debug: (message?: unknown, ...args: unknown[]) => void;
  readonly error: (message?: unknown, ...args: unknown[]) => void;
  readonly info: (message?: unknown, ...args: unknown[]) => void;
  readonly log: (message?: unknown, ...args: unknown[]) => void;
  readonly warn: (message?: unknown, ...args: unknown[]) => void;
}

export interface ConsoleLogSinkOptions {
  readonly writer?: ConsoleLogWriter;
}

export function createConsoleSink(options: ConsoleLogSinkOptions = {}): LogSink {
  const writer = options.writer ?? console;
  return {
    write: (record) => {
      writeConsoleRecord(writer, record, formatLogRecordText(record));
    },
  };
}

export function createJsonConsoleSink(options: ConsoleLogSinkOptions = {}): LogSink {
  const writer = options.writer ?? console;
  return {
    write: (record) => {
      writeConsoleRecord(writer, record, JSON.stringify(formatLogRecord(record)));
    },
  };
}

function writeConsoleRecord(writer: ConsoleLogWriter, record: LogRecord, message: string): void {
  switch (record.level) {
    case "trace":
    case "debug":
      writer.debug(message);
      break;
    case "info":
      writer.info(message);
      break;
    case "warn":
      writer.warn(message);
      break;
    case "error":
    case "fatal":
      writer.error(message);
      break;
  }
}
