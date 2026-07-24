import {
  ROOT_CONTEXT,
  context,
  trace,
  type Context,
  type ContextManager,
} from "@opentelemetry/api";
import {
  SeverityNumber,
  logs,
  type Logger as OpenTelemetryLogger,
  type LoggerProvider,
  type LogRecord as OpenTelemetryLogRecord,
} from "@opentelemetry/api-logs";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, test } from "vitest";

import type { LogRecord, LogSink } from "./types.ts";

import { createJsonConsoleSink } from "./console.ts";
import { createLevelFilterSink } from "./filter.ts";
import { formatLogRecord } from "./format.ts";
import { createLogger } from "./logger.ts";
import { createMultiplexSink } from "./multiplex.ts";
import { createOpenTelemetryLogSink } from "./otel.ts";

describe("logger", () => {
  afterEach(() => {
    context.disable();
    logs.disable();
    trace.disable();
  });

  test("it works", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: createMemorySink(records),
      level: "info",
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
      attributes: { service: "api", requestId: "root" },
    });

    const child = logger.child({ requestId: "child", userId: "user_1" });

    child.debug("hidden");
    child.info("visible", { requestId: "call", route: "/checkout" });

    expect(records).toEqual([
      {
        level: "info",
        message: "visible",
        timestamp: Temporal.Instant.from("2025-01-01T10:00:00Z"),
        attributes: {
          requestId: "call",
          route: "/checkout",
          service: "api",
          userId: "user_1",
        },
      },
    ]);
  });

  test("formats errors and JSON-safe values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const error = new Error("boom");

    expect(
      formatLogRecord({
        level: "error",
        message: "failed",
        timestamp: Temporal.Instant.from("2025-01-01T10:00:00Z"),
        attributes: {
          bigint: 1n,
          circular,
        },
        error,
      }),
    ).toMatchObject({
      timestamp: "2025-01-01T10:00:00Z",
      level: "error",
      message: "failed",
      bigint: "1",
      circular: { self: "[Circular]" },
      "error.name": "Error",
      "error.message": "boom",
    });
  });

  test("preserves canonical formatted fields over attributes", () => {
    expect(
      formatLogRecord({
        level: "info",
        message: "canonical message",
        timestamp: Temporal.Instant.from("2025-01-01T10:00:00Z"),
        attributes: {
          level: "fatal",
          message: "attribute message",
          timestamp: "1999-01-01T00:00:00Z",
          requestId: "request_1",
        },
      }),
    ).toEqual({
      timestamp: "2025-01-01T10:00:00Z",
      level: "info",
      message: "canonical message",
      requestId: "request_1",
    });
  });

  test("promotes attributes.error for error logs", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: createMemorySink(records),
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });

    const error = new Error("boom");
    logger.error("failed", { error, operation: "charge" });

    expect(records).toEqual([
      {
        level: "error",
        message: "failed",
        timestamp: Temporal.Instant.from("2025-01-01T10:00:00Z"),
        attributes: { operation: "charge" },
        error,
      },
    ]);
  });

  test("tracks async sink writes and flushes them", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: {
        write: async (record) => {
          await Promise.resolve();
          records.push(record);
        },
      },
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });

    logger.info("queued");
    expect(records).toEqual([]);

    await logger.flush();

    expect(records).toHaveLength(1);
  });

  test("flushes async sink writes from child loggers", async () => {
    const records: LogRecord[] = [];
    let releaseWrite!: () => void;
    const writeStarted = Promise.withResolvers<void>();
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const logger = createLogger({
      sink: {
        write: async (record) => {
          writeStarted.resolve();
          await writeReleased;
          records.push(record);
        },
      },
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });

    logger.child({ scope: "child" }).info("queued from child");
    await writeStarted.promise;
    const flushed = logger.flush();

    expect(records).toEqual([]);

    releaseWrite();
    await flushed;

    expect(records).toMatchObject([
      {
        message: "queued from child",
        attributes: { scope: "child" },
      },
    ]);
  });

  test("isolates sink failures unless strict mode is enabled", async () => {
    const loose = createLogger({
      sink: {
        write: () => {
          throw new Error("sink failed");
        },
      },
    });
    const strict = createLogger({
      sink: {
        write: () => {
          throw new Error("sink failed");
        },
      },
      sinkFailureMode: "throw",
    });

    expect(() => loose.info("ok")).not.toThrow();
    expect(() => strict.info("boom")).toThrow("sink failed");
  });

  test("multiplexes sinks and supports level-filter sink", () => {
    const left: LogRecord[] = [];
    const right: LogRecord[] = [];
    const logger = createLogger({
      sink: createMultiplexSink([
        createMemorySink(left),
        createLevelFilterSink(createMemorySink(right), "warn"),
      ]),
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });

    logger.info("info");
    logger.warn("warn");

    expect(left.map((record) => record.message)).toEqual(["info", "warn"]);
    expect(right.map((record) => record.message)).toEqual(["warn"]);
  });

  test("writes JSON console records", () => {
    const messages: unknown[] = [];
    const logger = createLogger({
      sink: createJsonConsoleSink({
        writer: {
          debug: (message) => messages.push(message),
          error: (message) => messages.push(message),
          info: (message) => messages.push(message),
          log: (message) => messages.push(message),
          warn: (message) => messages.push(message),
        },
      }),
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });

    logger.info("hello", { answer: 42 });

    expect(messages).toEqual([
      JSON.stringify({
        timestamp: "2025-01-01T10:00:00Z",
        level: "info",
        message: "hello",
        answer: 42,
      }),
    ]);
  });

  test("attaches log records to the active OpenTelemetry span", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    context.setGlobalContextManager(new TestContextManager());
    trace.setGlobalTracerProvider(provider);
    const tracer = trace.getTracer("temelj.log.test");
    const logger = createLogger({
      sink: createOpenTelemetryLogSink(),
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });

    const span = tracer.startSpan("operation");
    await context.with(trace.setSpan(context.active(), span), async () => {
      logger.info("hello", { answer: 42 });
      span.end();
    });
    await provider.forceFlush();

    expect(exporter.getFinishedSpans()[0]?.events).toEqual([
      expect.objectContaining({
        name: "log.info",
        attributes: expect.objectContaining({
          timestamp: "2025-01-01T10:00:00Z",
          level: "info",
          message: "hello",
          answer: 42,
        }),
      }),
    ]);
  });

  test("can emit OpenTelemetry log records", () => {
    const provider = new TestLoggerProvider();
    logs.setGlobalLoggerProvider(provider);
    const logger = createLogger({
      sink: createOpenTelemetryLogSink({ attachToActiveSpan: false, emitLogs: true }),
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });

    logger.warn("careful", { answer: 42 });

    expect(provider.records).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          timestamp: "2025-01-01T10:00:00Z",
          level: "warn",
          message: "careful",
          answer: 42,
        }),
        body: "careful",
        eventName: "log.warn",
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
        timestamp: Temporal.Instant.from("2025-01-01T10:00:00Z").epochMilliseconds,
      }),
    ]);
  });
});

function createMemorySink(records: LogRecord[]): LogSink {
  return {
    write: (record) => {
      records.push(record);
    },
  };
}

class TestContextManager implements ContextManager {
  #active: Context = ROOT_CONTEXT;

  active(): Context {
    return this.#active;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    contextValue: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const previous = this.#active;
    this.#active = contextValue;
    try {
      return fn.apply(thisArg, args);
    } finally {
      this.#active = previous;
    }
  }

  bind<T>(_: Context, target: T): T {
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this.#active = ROOT_CONTEXT;
    return this;
  }
}

class TestLoggerProvider implements LoggerProvider {
  readonly records: OpenTelemetryLogRecord[] = [];

  getLogger(): OpenTelemetryLogger {
    return {
      emit: (record) => {
        this.records.push(record);
      },
      enabled: () => true,
    };
  }
}
