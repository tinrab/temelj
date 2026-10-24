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

interface SinkWrites {
  readonly pending: Set<Promise<void>>;
  failure: { readonly cause: unknown } | undefined;
}

export function createLogger(options: CreateLoggerOptions): LoggerContract {
  return new Logger(
    options.sink,
    options.level ?? "info",
    options.now ?? Temporal.Now.instant,
    options.attributes ?? {},
    options.sinkFailureMode ?? "ignore",
    { pending: new Set(), failure: undefined },
  );
}

class Logger implements LoggerContract {
  readonly #writes: SinkWrites;
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
    writes: SinkWrites,
  ) {
    this.#sink = sink;
    this.#level = level;
    this.#now = now;
    this.#attributes = attributes;
    this.#sinkFailureMode = sinkFailureMode;
    this.#writes = writes;
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
      this.#writes,
    );
  }

  async flush(): Promise<void> {
    await Promise.all(this.#writes.pending);
    const failure = this.#writes.failure;
    this.#writes.failure = undefined;

    if (failure !== undefined) {
      throw failure.cause;
    }

    await this.#sink.flush?.();
  }

  async close(): Promise<void> {
    let failure: { cause: unknown } | undefined;

    try {
      await this.flush();
    } catch (cause) {
      failure = { cause };
    }

    try {
      await this.#sink.close?.();
    } catch (cause) {
      if (failure !== undefined) {
        throw new AggregateError([failure.cause, cause], "Log sink flush and close failed");
      }

      throw cause;
    }

    if (failure !== undefined) {
      throw failure.cause;
    }
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
          this.#writes.failure ??= { cause };
        }
      })
      .finally(() => {
        this.#writes.pending.delete(tracked);
      });
    this.#writes.pending.add(tracked);
  }
}

function mergeAttributes(base: LogAttributes, overrides: LogAttributes | undefined): LogAttributes {
  if (overrides === undefined) {
    return base;
  }

  return { ...base, ...overrides };
}
