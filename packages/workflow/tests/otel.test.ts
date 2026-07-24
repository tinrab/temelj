import type {
  Attributes,
  Context,
  ContextManager,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
} from "@opentelemetry/api";
import type { MetricData } from "@opentelemetry/sdk-metrics";

import { ROOT_CONTEXT, TraceFlags, context, metrics, propagation, trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, test } from "vitest";

import { implementWorkflow } from "../src/definition.ts";
import { createWorkflowEngine } from "../src/engine/create.ts";
import { createOpenTelemetryTelemetry } from "../src/otel.ts";
import {
  WORKFLOW_ATTRIBUTES,
  WORKFLOW_METRIC_NAMES,
  WORKFLOW_SPAN_NAMES,
  WORKFLOW_SYSTEM,
} from "../src/telemetry.ts";

describe("OpenTelemetry workflow telemetry", () => {
  afterEach(() => {
    context.disable();
    propagation.disable();
    trace.disable();
    metrics.disable();
  });

  test("emits workflow spans and low-cardinality metrics", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter });
    const meterProvider = new MeterProvider({ readers: [metricReader] });
    context.setGlobalContextManager(new TestContextManager());
    propagation.setGlobalPropagator(new TestTraceContextPropagator());
    trace.setGlobalTracerProvider(tracerProvider);
    metrics.setGlobalMeterProvider(meterProvider);

    const engine = createWorkflowEngine({
      createRunId: () => "run-otel",
      now: fixedClock([
        "2026-06-15T10:00:00Z",
        "2026-06-15T10:00:01Z",
        "2026-06-15T10:00:02Z",
        "2026-06-15T10:00:03Z",
      ]),
      telemetry: createOpenTelemetryTelemetry({
        serviceNamespace: "billing",
      }),
    });
    const workflow = implementWorkflow(
      { name: "otel-workflow", version: "v1" },
      async ({ step }) => {
        return await step.task.run({ name: "charge" }, () => "charged");
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined);
    await tracerProvider.forceFlush();
    await metricReader.forceFlush();

    expect(result).toMatchObject({ kind: "completed", output: "charged" });
    expect(
      spanExporter
        .getFinishedSpans()
        .map((span) => span.name)
        .sort(),
    ).toEqual(
      expect.arrayContaining([WORKFLOW_SPAN_NAMES.runExecution, WORKFLOW_SPAN_NAMES.stepExecution]),
    );
    expect(
      spanExporter.getFinishedSpans().map((span) => ({
        attributes: span.attributes,
        name: span.name,
        status: span.status,
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: expect.objectContaining({
            [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
            [WORKFLOW_ATTRIBUTES.workflowName]: "otel-workflow",
            [WORKFLOW_ATTRIBUTES.runId]: "run-otel",
            [WORKFLOW_ATTRIBUTES.runStatus]: "completed",
            [WORKFLOW_ATTRIBUTES.runTransition]: "completed",
          }),
          name: WORKFLOW_SPAN_NAMES.runExecution,
        }),
        expect.objectContaining({
          attributes: expect.objectContaining({
            [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
            [WORKFLOW_ATTRIBUTES.stepId]: "run:charge",
            [WORKFLOW_ATTRIBUTES.stepKind]: "run",
            [WORKFLOW_ATTRIBUTES.stepName]: "charge",
          }),
          name: WORKFLOW_SPAN_NAMES.stepExecution,
        }),
      ]),
    );

    const metricData = allMetricData(metricExporter);
    expect(metricData.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([
        WORKFLOW_METRIC_NAMES.runTransitions,
        WORKFLOW_METRIC_NAMES.eventsAppended,
        WORKFLOW_METRIC_NAMES.stepDuration,
      ]),
    );
    for (const attributes of allMetricAttributes(metricData)) {
      expect(attributes).toHaveProperty(WORKFLOW_ATTRIBUTES.system, WORKFLOW_SYSTEM);
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.runId);
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.stepId);
      expect(attributes).not.toHaveProperty("workflow.message.id");
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.streamId);
    }
  });

  test("can include workflow and step names in span names while preserving trace lineage", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    context.setGlobalContextManager(new TestContextManager());
    propagation.setGlobalPropagator(new TestTraceContextPropagator());
    trace.setGlobalTracerProvider(tracerProvider);

    const engine = createWorkflowEngine({
      createRunId: () => "run-otel-named",
      telemetry: createOpenTelemetryTelemetry({
        includeNamesInSpanNames: true,
      }),
    });
    const workflow = implementWorkflow({ name: "otel-named" }, async ({ step }) => {
      return await step.task.run({ name: "named-step" }, () => "done");
    });
    const tracer = trace.getTracer("workflow-test");
    let externalSpanId: string | undefined;

    const result = await tracer.startActiveSpan("external-request", async (span) => {
      externalSpanId = span.spanContext().spanId;
      try {
        return await engine.runWorkflowNow(workflow, undefined);
      } finally {
        span.end();
      }
    });
    await tracerProvider.forceFlush();

    expect(result).toMatchObject({ kind: "completed", output: "done" });

    const spans = spanExporter.getFinishedSpans();
    const runSpan = spans.find(
      (span) => span.name === `${WORKFLOW_SPAN_NAMES.runExecution} otel-named`,
    );
    const stepSpan = spans.find(
      (span) => span.name === `${WORKFLOW_SPAN_NAMES.stepExecution} named-step`,
    );

    expect(runSpan?.parentSpanContext?.spanId).toBe(externalSpanId);
    expect(stepSpan?.parentSpanContext?.spanId).toBe(runSpan?.spanContext().spanId);
    expect(stepSpan?.spanContext().traceId).toBe(runSpan?.spanContext().traceId);
  });

  test("engine close flushes and shuts down OpenTelemetry adapter resources", async () => {
    const order: string[] = [];
    const engine = createWorkflowEngine({
      telemetry: createOpenTelemetryTelemetry({
        forceFlush: () => {
          order.push("flush");
        },
        shutdown: () => {
          order.push("shutdown");
        },
      }),
    });

    await engine.close();

    expect(order).toEqual(["flush", "shutdown"]);
  });

  test("does not record task callback exceptions on the parent run span", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    const engine = createWorkflowEngine({
      createRunId: () => "run-otel-step-error",
      telemetry: createOpenTelemetryTelemetry(),
    });
    const taskError = new Error("task callback failed");
    const workflow = implementWorkflow({ name: "otel-step-error" }, async ({ step }) => {
      await step.task.run({ name: "explode" }, () => {
        throw taskError;
      });
    });

    const result = await engine.runWorkflowNow(workflow, undefined);
    await tracerProvider.forceFlush();

    expect(result).toMatchObject({
      error: { message: "Workflow step failed: explode" },
      kind: "failed",
    });

    const runSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === WORKFLOW_SPAN_NAMES.runExecution);
    const stepSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === WORKFLOW_SPAN_NAMES.stepExecution);

    expect(exceptionMessages(stepSpan)).toContain("task callback failed");
    expect(exceptionMessages(runSpan)).not.toContain("task callback failed");
    expect(exceptionMessages(runSpan)).toContain("Workflow step failed: explode");
  });
});

function fixedClock(values: readonly string[]): () => Temporal.Instant {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index++;
    return Temporal.Instant.from(value);
  };
}

function allMetricData(exporter: InMemoryMetricExporter): readonly MetricData[] {
  return exporter
    .getMetrics()
    .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
    .flatMap((scopeMetrics) => scopeMetrics.metrics);
}

function allMetricAttributes(metricsData: readonly MetricData[]): readonly Attributes[] {
  return metricsData.flatMap((metric) => metric.dataPoints.map((point) => point.attributes));
}

function exceptionMessages(span: ReadableSpan | undefined): readonly unknown[] {
  return (
    span?.events
      .filter((event) => event.name === "exception")
      .map((event) => event.attributes?.["exception.message"]) ?? []
  );
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
    let restoreDeferred = false;
    this.#active = contextValue;
    try {
      const result = fn.apply(thisArg, args);
      if (isPromiseLike(result)) {
        restoreDeferred = true;
        return result.finally(() => {
          this.#active = previous;
        }) as TResult;
      }
      this.#active = previous;
      return result;
    } finally {
      if (!restoreDeferred && this.#active === contextValue) {
        this.#active = previous;
      }
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

class TestTraceContextPropagator implements TextMapPropagator {
  inject(contextValue: Context, carrier: Record<string, string>, setter: TextMapSetter): void {
    const spanContext = trace.getSpanContext(contextValue);
    if (spanContext === undefined) {
      return;
    }
    setter.set(
      carrier,
      "traceparent",
      `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`,
    );
  }

  extract(contextValue: Context, carrier: Record<string, string>, getter: TextMapGetter): Context {
    const traceparent = getter.get(carrier, "traceparent");
    const value = Array.isArray(traceparent) ? traceparent[0] : traceparent;
    if (typeof value !== "string") {
      return contextValue;
    }
    const parts = value.split("-");
    const [, traceId, spanId, flags] = parts;
    if (parts.length !== 4 || traceId === undefined || spanId === undefined) {
      return contextValue;
    }
    return trace.setSpanContext(contextValue, {
      traceId,
      spanId,
      traceFlags: flags === "01" ? TraceFlags.SAMPLED : TraceFlags.NONE,
    });
  }

  fields(): string[] {
    return ["traceparent"];
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "finally" in value &&
    typeof value.finally === "function"
  );
}
