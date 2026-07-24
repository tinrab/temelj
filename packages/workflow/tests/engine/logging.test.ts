import {
  ROOT_CONTEXT,
  context,
  trace,
  type Context,
  type ContextManager,
} from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createLogger, type LogRecord, type LogSink } from "@temelj/log";
import { createOpenTelemetryLogSink } from "@temelj/log/otel";
import { afterEach, describe, expect, test } from "vitest";

import { defineWorkflow, implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { createOpenTelemetryTelemetry } from "../../src/otel.ts";

describe("workflow logging", () => {
  afterEach(() => {
    context.disable();
    trace.disable();
  });

  test("passes scoped loggers to workflow handlers and durable task callbacks", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: createMemorySink(records),
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });
    const engine = createWorkflowEngine({
      createRunId: () => "run_logging_scope",
      logger,
    });
    const workflow = implementWorkflow(
      { name: "logging-scope", version: "v1" },
      async ({ log, step }) => {
        log.info("workflow started");
        return await step.task.run({ name: "charge" }, ({ log }) => {
          log.info("step started", { provider: "stripe" });
          return "charged";
        });
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "charged",
    });

    expect(records).toMatchObject([
      {
        level: "info",
        message: "workflow started",
        attributes: {
          "workflow.system": "temelj",
          "workflow.name": "logging-scope",
          "workflow.version": "v1",
          "workflow.run.id": "run_logging_scope",
          "workflow.namespace": "default",
          "workflow.run.attempt": 1,
          "workflow.replay": false,
        },
      },
      {
        level: "info",
        message: "step started",
        attributes: {
          "workflow.system": "temelj",
          "workflow.name": "logging-scope",
          "workflow.version": "v1",
          "workflow.run.id": "run_logging_scope",
          "workflow.step.id": "run:charge",
          "workflow.step.name": "charge",
          "workflow.step.kind": "run",
          "workflow.step.attempt": 1,
          "workflow.replay": false,
          provider: "stripe",
        },
      },
    ]);
  });

  test("does not duplicate workflow-body or completed task logs during replay", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: createMemorySink(records),
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });
    let now = Temporal.Instant.from("2025-01-01T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_logging_replay",
      logger,
      now: () => now,
    });
    const workflow = implementWorkflow({ name: "logging-replay" }, async ({ log, step }) => {
      log.info("workflow body");
      await step.task.run({ name: "work" }, ({ log }) => {
        log.info("task body");
      });
      await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      log.info("after pause");
      step.log.info("step after pause");
      return "done";
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2025-01-01T10:00:02Z");
    await expect(engine.resumeWorkflow(workflow, "run_logging_replay")).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    expect(records.map((record) => record.message)).toEqual([
      "workflow body",
      "task body",
      "after pause",
      "step after pause",
    ]);
  });

  test("keeps first execution logs when pending runs already have messages", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: createMemorySink(records),
      now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
    });
    const engine = createWorkflowEngine({
      createRunId: () => "run_logging_prestart_message",
      logger,
    });
    const definition = defineWorkflow<undefined, string>({
      name: "logging-prestart-message",
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "logging-prestart-message" },
      ({ log }) => {
        log.info("workflow first execution");
        return "done";
      },
    );

    const handle = await engine.startWorkflow(definition, undefined);
    await engine.sendMessage(handle.runId, { messageId: "ready", payload: "queued" });
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    expect(records.map((record) => record.message)).toEqual(["workflow first execution"]);
  });

  test("exposes step.log as a logger property, not a callable workflow command", () => {
    const workflow = implementWorkflow({ name: "logging-step-log" }, async ({ step }) => {
      step.log.info("orchestration log");
      // @ts-expect-error step.log is a Logger object, not a callable durable command.
      step.log("not supported");
      return "done";
    });

    expect(workflow.name).toBe("logging-step-log");
  });

  test("attaches durable task logs to active OpenTelemetry step spans", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    context.setGlobalContextManager(new TestContextManager());
    trace.setGlobalTracerProvider(tracerProvider);

    const engine = createWorkflowEngine({
      createRunId: () => "run_logging_otel",
      logger: createLogger({
        sink: createOpenTelemetryLogSink(),
        now: () => Temporal.Instant.from("2025-01-01T10:00:00Z"),
      }),
      telemetry: createOpenTelemetryTelemetry(),
    });
    const workflow = implementWorkflow({ name: "logging-otel" }, async ({ step }) => {
      return await step.task.run({ name: "work" }, ({ log }) => {
        log.info("step log", { answer: 42 });
        return "done";
      });
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await tracerProvider.forceFlush();

    const stepSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "temelj.workflow.step");

    expect(stepSpan?.events).toEqual([
      expect.objectContaining({
        name: "log.info",
        attributes: expect.objectContaining({
          message: "step log",
          answer: 42,
          "workflow.system": "temelj",
          "workflow.name": "logging-otel",
          "workflow.run.id": "run_logging_otel",
          "workflow.step.id": "run:work",
          "workflow.step.name": "work",
          "workflow.step.attempt": 1,
        }),
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

  with<A extends unknown[], TResult>(
    contextValue: Context,
    fn: (...args: A) => TResult,
    thisArg?: unknown,
    ...args: A
  ): TResult {
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
