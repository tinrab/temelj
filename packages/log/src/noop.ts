import type { Logger, LogSink } from "./types.ts";

export function createNoopSink(): LogSink {
  return {
    write: () => {},
  };
}

export function createNoopLogger(): Logger {
  return {
    log: () => {},
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => createNoopLogger(),
    flush: async () => {},
    close: async () => {},
  };
}
