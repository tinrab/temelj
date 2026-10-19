import type {
  CreateLoggerOptions,
  LogAttributes,
  Logger as LoggerContract,
  LogLevel,
  LogRecord,
  LogSink,
  LogSinkFailureMode,
} from "./types.ts";

import { isLogLevelEnabled } from "./filter.ts";

export function createLogger(options: CreateLoggerOptions): LoggerContract {
  return new Logger(
    options.sink,
    options.level ?? "info",
    options.now ?? Temporal.Now.instant,
    options.attributes ?? {},
    options.sinkFailureMode ?? "ignore",
    new Set(),
  );
}

class Logger implements LoggerContract {
  readonly #pending: Set<Promise<void>>;
  readonly #sink: LogSink;
  readonly #level: LogLevel;
  readonly #now: () => Temporal.Instant;
  readonly #attributes: LogAttributes;
  readonly #sinkFailureMode: LogSinkFailureMode;

  constructor(
    sink: LogSink,
    level: LogLevel,
    now: () => Temporal.Instant,
    attributes: LogAttributes,
    sinkFailureMode: LogSinkFailureMode,
    pending: Set<Promise<void>>,
  ) {
    this.#sink = sink;
    this.#level = level;
    this.#now = now;
    this.#attributes = attributes;
    this.#sinkFailureMode = sinkFailureMode;
    this.#pending = pending;
  }

  log(level: LogLevel, message: string, attributes?: LogAttributes): void {
    this.#emit(level, message, attributes);
  }

  #emit(level: LogLevel, message: string, attributes?: LogAttributes, cause?: unknown): void {
    if (!isLogLevelEnabled(level, this.#level)) {
      return;
    }

    const record: LogRecord = {
      level,
      message,
      timestamp: this.#now(),
      attributes: mergeAttributes(this.#attributes, attributes),
    };

    if (cause !== undefined) {
      record.error = cause;
    }

    this.#write(record);
  }

  trace(message: string, attributes?: LogAttributes): void {
    this.log("trace", message, attributes);
  }

  debug(message: string, attributes?: LogAttributes): void {
    this.log("debug", message, attributes);
  }

  info(message: string, attributes?: LogAttributes): void {
    this.log("info", message, attributes);
  }

  warn(message: string, attributes?: LogAttributes): void {
    this.log("warn", message, attributes);
  }

  error(message: string, cause: unknown, attributes?: LogAttributes): void {
    this.#emit("error", message, attributes, cause);
  }

  fatal(message: string, cause: unknown, attributes?: LogAttributes): void {
    this.#emit("fatal", message, attributes, cause);
  }

  child(attributes: LogAttributes): LoggerContract {
    return new Logger(
      this.#sink,
      this.#level,
      this.#now,
      mergeAttributes(this.#attributes, attributes),
      this.#sinkFailureMode,
      this.#pending,
    );
  }

  async flush(): Promise<void> {
    await Promise.all(this.#pending);
    await this.#sink.flush?.();
  }

  async close(): Promise<void> {
    await this.flush();
    await this.#sink.close?.();
  }

  #write(record: LogRecord): void {
    try {
      const write = this.#sink.write(record);

      if (write !== undefined) {
        this.#track(write);
      }
    } catch (error) {
      if (this.#sinkFailureMode === "throw") {
        throw error;
      }
    }
  }

  #track(write: Promise<void>): void {
    let tracked: Promise<void>;
    tracked = write
      .catch((cause: unknown) => {
        if (this.#sinkFailureMode === "throw") {
          throw cause;
        }
      })
      .finally(() => {
        this.#pending.delete(tracked);
      });
    this.#pending.add(tracked);
  }
}

function mergeAttributes(base: LogAttributes, overrides: LogAttributes | undefined): LogAttributes {
  if (overrides === undefined) {
    return base;
  }

  return { ...base, ...overrides };
}
