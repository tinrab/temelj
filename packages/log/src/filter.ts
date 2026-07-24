import type { LogLevel, LogSink } from "./types.ts";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

export function logLevelPriority(level: LogLevel): number {
  return LOG_LEVEL_PRIORITY[level];
}

export function isLogLevelEnabled(recordLevel: LogLevel, minimumLevel: LogLevel): boolean {
  return logLevelPriority(recordLevel) >= logLevelPriority(minimumLevel);
}

export function createLevelFilterSink(sink: LogSink, level: LogLevel): LogSink {
  return {
    write: (record) => {
      if (!isLogLevelEnabled(record.level, level)) {
        return;
      }
      return sink.write(record);
    },
    flush: sink.flush === undefined ? undefined : async () => await sink.flush?.(),
    close: sink.close === undefined ? undefined : async () => await sink.close?.(),
  };
}
