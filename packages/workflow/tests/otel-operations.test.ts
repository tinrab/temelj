import type { Attributes } from "@opentelemetry/api";
import type { MetricData } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

import { SpanStatusCode, metrics, trace } from "@opentelemetry/api";
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

describe("OpenTelemetry workflow operation telemetry", () => {
  afterEach(() => {
    trace.disable();
    metrics.disable();
  });

  test("emits stream operation spans without high-cardinality stream metric attributes", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter });
    const meterProvider = new MeterProvider({ readers: [metricReader] });
    trace.setGlobalTracerProvider(tracerProvider);
    metrics.setGlobalMeterProvider(meterProvider);

    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run-otel-stream-closed", "run-otel-stream-failed"),
      telemetry: createOpenTelemetryTelemetry(),
    });
    const closedWorkflow = implementWorkflow({ name: "otel-stream-closed" }, async ({ step }) => {
      const stream = step.stream.create<string>("progress");
      await stream.write("started");
      await stream.close();
      return "done";
    });
    const failedWorkflow = implementWorkflow({ name: "otel-stream-failed" }, async ({ step }) => {
      const stream = step.stream.create<string>("progress");
      await stream.error(new Error("stream failed"));
      return "failed stream recorded";
    });

    await expect(engine.runWorkflowNow(closedWorkflow, undefined)).resolves.toMatchObject({
      kind: "completed",
    });
    await expect(engine.runWorkflowNow(failedWorkflow, undefined)).resolves.toMatchObject({
      kind: "completed",
    });
    await tracerProvider.forceFlush();
    await metricReader.forceFlush();

    const streamSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === WORKFLOW_SPAN_NAMES.streamOperation);
    expect(
      streamSpans
        .map((span) => String(span.attributes[WORKFLOW_ATTRIBUTES.streamEventKind]))
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual([
      "stream_chunk",
      "stream_closed",
      "stream_failed",
      "stream_started",
      "stream_started",
    ]);
    expect(streamSpans.map((span) => span.attributes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.runId]: "run-otel-stream-closed",
          [WORKFLOW_ATTRIBUTES.streamId]: "progress",
          [WORKFLOW_ATTRIBUTES.streamEventKind]: "stream_chunk",
          [WORKFLOW_ATTRIBUTES.streamIndex]: 0,
          [WORKFLOW_ATTRIBUTES.streamStatus]: "open",
          [WORKFLOW_ATTRIBUTES.stepId]: "stream:progress",
          [WORKFLOW_ATTRIBUTES.stepName]: "progress",
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.runId]: "run-otel-stream-failed",
          [WORKFLOW_ATTRIBUTES.streamEventKind]: "stream_failed",
          [WORKFLOW_ATTRIBUTES.streamStatus]: "failed",
          [WORKFLOW_ATTRIBUTES.errorKind]: "Error",
        }),
      ]),
    );
    const failedSpan = streamSpans.find(
      (span) => span.attributes[WORKFLOW_ATTRIBUTES.streamEventKind] === "stream_failed",
    );
    expect(failedSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(exceptionMessages(failedSpan)).toContain("stream failed");

    const metricData = allMetricData(metricExporter);
    expect(metricData.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([WORKFLOW_METRIC_NAMES.streamUpdates]),
    );
    for (const attributes of metricAttributes(metricData, WORKFLOW_METRIC_NAMES.streamUpdates)) {
      expect(attributes).toHaveProperty(WORKFLOW_ATTRIBUTES.system, WORKFLOW_SYSTEM);
      expect(attributes).toHaveProperty(WORKFLOW_ATTRIBUTES.streamEventKind);
      expect(attributes).toHaveProperty(WORKFLOW_ATTRIBUTES.streamStatus);
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.runId);
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.streamId);
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.stepId);
    }
  });

  test("emits durable sleep completion spans", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    let now = Temporal.Instant.from("2026-06-15T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run-otel-sleep",
      now: () => now,
      telemetry: createOpenTelemetryTelemetry(),
    });
    const workflow = implementWorkflow({ name: "otel-sleep" }, async ({ step }) => {
      await step.task.sleep("pause", Temporal.Duration.from({ seconds: 5 }));
      return "awake";
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-15T10:00:06Z");
    await expect(engine.resumeWorkflow(workflow, "run-otel-sleep")).resolves.toMatchObject({
      kind: "completed",
      output: "awake",
    });
    await tracerProvider.forceFlush();

    const sleepSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === WORKFLOW_SPAN_NAMES.sleep);
    expect(sleepSpan?.attributes).toEqual(
      expect.objectContaining({
        [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        [WORKFLOW_ATTRIBUTES.runId]: "run-otel-sleep",
        [WORKFLOW_ATTRIBUTES.stepId]: "sleep:pause",
        [WORKFLOW_ATTRIBUTES.stepKind]: "sleep",
        [WORKFLOW_ATTRIBUTES.stepName]: "pause",
        [WORKFLOW_ATTRIBUTES.sleepUntil]: "2026-06-15T10:00:05Z",
        [WORKFLOW_ATTRIBUTES.sleepDurationMs]: 5000,
        [WORKFLOW_ATTRIBUTES.sleepActualMs]: 6000,
      }),
    );
    expect(sleepSpan?.status.code).toBe(SpanStatusCode.OK);
  });
});

function allMetricData(exporter: InMemoryMetricExporter): readonly MetricData[] {
  return exporter
    .getMetrics()
    .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
    .flatMap((scopeMetrics) => scopeMetrics.metrics);
}

function metricAttributes(
  metricsData: readonly MetricData[],
  metricName: string,
): readonly Attributes[] {
  return metricsData
    .filter((metric) => metric.descriptor.name === metricName)
    .flatMap((metric) => metric.dataPoints.map((point) => point.attributes));
}

function sequentialRunIds(...ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = ids[index];
    index++;
    if (value === undefined) {
      throw new Error("Unexpected run ID request");
    }
    return value;
  };
}

function exceptionMessages(span: ReadableSpan | undefined): readonly unknown[] {
  return (
    span?.events
      .filter((event) => event.name === "exception")
      .map((event) => event.attributes?.["exception.message"]) ?? []
  );
}
