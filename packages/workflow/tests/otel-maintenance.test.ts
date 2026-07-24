import type { Attributes } from "@opentelemetry/api";
import type { MetricData } from "@opentelemetry/sdk-metrics";

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

describe("OpenTelemetry workflow maintenance telemetry", () => {
  afterEach(() => {
    trace.disable();
    metrics.disable();
  });

  test("emits scheduled run creation spans and due latency metrics", async () => {
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
      createRunId: () => "run-otel-schedule",
      now: () => Temporal.Instant.from("2026-06-15T10:00:00Z"),
      telemetry: createOpenTelemetryTelemetry(),
    });
    const workflow = implementWorkflow({ name: "otel-schedule", version: "v1" }, () => "scheduled");

    await engine.createSchedule(workflow, {
      id: "daily-report",
      every: Temporal.Duration.from({ hours: 1 }),
      from: Temporal.Instant.from("2026-06-15T09:00:00Z"),
      input: undefined,
    });
    await expect(
      engine.tickSchedules({ now: Temporal.Instant.from("2026-06-15T10:00:30Z") }),
    ).resolves.toMatchObject({
      runIds: ["run-otel-schedule"],
      scheduleIds: ["daily-report"],
      ticked: 1,
    });
    await tracerProvider.forceFlush();
    await metricReader.forceFlush();

    const scheduleTickSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === WORKFLOW_SPAN_NAMES.scheduleTick);
    expect(scheduleTickSpan?.attributes).toEqual(
      expect.objectContaining({
        [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        [WORKFLOW_ATTRIBUTES.scheduleTickedRuns]: 1,
        [WORKFLOW_ATTRIBUTES.scheduleTickedSchedules]: 1,
        [WORKFLOW_ATTRIBUTES.scheduleNextAt]: "2026-06-15T11:00:00Z",
      }),
    );
    expect(scheduleTickSpan?.status.code).toBe(SpanStatusCode.OK);

    const scheduleSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === WORKFLOW_SPAN_NAMES.scheduleRunCreate);
    expect(scheduleSpan?.attributes).toEqual(
      expect.objectContaining({
        [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        [WORKFLOW_ATTRIBUTES.workflowName]: "otel-schedule",
        [WORKFLOW_ATTRIBUTES.workflowVersion]: "v1",
        [WORKFLOW_ATTRIBUTES.scheduleId]: "daily-report",
        [WORKFLOW_ATTRIBUTES.scheduleFireAt]: "2026-06-15T10:00:00Z",
        [WORKFLOW_ATTRIBUTES.runId]: "run-otel-schedule",
      }),
    );

    const metricData = allMetricData(metricExporter);
    expect(metricData.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([WORKFLOW_METRIC_NAMES.scheduleDueToRunCreatedLatency]),
    );
    expect(
      metricAttributes(metricData, WORKFLOW_METRIC_NAMES.scheduleDueToRunCreatedLatency),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.workflowName]: "otel-schedule",
          [WORKFLOW_ATTRIBUTES.workflowVersion]: "v1",
        }),
      ]),
    );
    for (const attributes of metricAttributes(
      metricData,
      WORKFLOW_METRIC_NAMES.scheduleDueToRunCreatedLatency,
    )) {
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.runId);
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.scheduleId);
    }
  });

  test("emits cleanup and retention operation spans", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter });
    const meterProvider = new MeterProvider({ readers: [metricReader] });
    trace.setGlobalTracerProvider(tracerProvider);
    metrics.setGlobalMeterProvider(meterProvider);

    let now = Temporal.Instant.from("2026-06-01T10:00:00Z");
    const runIds = ["run-otel-cleanup", "run-otel-retention"];
    const engine = createWorkflowEngine({
      createRunId: () => runIds.shift() ?? "run-otel-extra",
      now: () => now,
      telemetry: createOpenTelemetryTelemetry(),
    });
    const workflow = implementWorkflow({ name: "otel-cleanup" }, () => "done");

    await engine.runWorkflowNow(workflow, undefined);
    await expect(
      engine.cleanupRuns({
        finishedAtBefore: Temporal.Instant.from("2026-06-02T00:00:00Z"),
      }),
    ).resolves.toMatchObject({ deletedRuns: 1 });

    now = Temporal.Instant.from("2026-06-02T10:00:00Z");
    await engine.runWorkflowNow(workflow, undefined);
    await expect(
      engine.applyRetentionPolicy({
        now: Temporal.Instant.from("2026-06-10T10:00:00Z"),
        olderThan: Temporal.Duration.from({ days: 7 }),
      }),
    ).resolves.toMatchObject({ deletedRuns: 1 });
    await tracerProvider.forceFlush();
    await metricReader.forceFlush();

    const cleanupSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === WORKFLOW_SPAN_NAMES.cleanupOperation);
    expect(cleanupSpans.map((span) => span.attributes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.cleanupSource]: "cleanup",
          [WORKFLOW_ATTRIBUTES.cleanupDeletedRuns]: 1,
          [WORKFLOW_ATTRIBUTES.cleanupCreatedMarkers]: 1,
          [WORKFLOW_ATTRIBUTES.cleanupDeletedMarkers]: 1,
          [WORKFLOW_ATTRIBUTES.cleanupDeletedEvents]: expect.any(Number),
          [WORKFLOW_ATTRIBUTES.cleanupDeletedStepAttempts]: expect.any(Number),
          [WORKFLOW_ATTRIBUTES.cleanupDeletedIdempotencyKeys]: expect.any(Number),
          [WORKFLOW_ATTRIBUTES.cleanupDeletedMessageIdempotencyKeys]: expect.any(Number),
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.cleanupSource]: "retention",
          [WORKFLOW_ATTRIBUTES.cleanupDeletedRuns]: 1,
          [WORKFLOW_ATTRIBUTES.cleanupMatchedRuns]: 1,
        }),
      ]),
    );
    expect(cleanupSpans.map((span) => span.status.code)).toEqual([
      SpanStatusCode.OK,
      SpanStatusCode.OK,
    ]);

    const metricData = allMetricData(metricExporter);
    expect(metricData.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([WORKFLOW_METRIC_NAMES.cleanupDeletedRuns]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.cleanupDeletedRuns)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.cleanupSource]: "cleanup",
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.cleanupSource]: "retention",
        }),
      ]),
    );
    for (const attributes of metricAttributes(
      metricData,
      WORKFLOW_METRIC_NAMES.cleanupDeletedRuns,
    )) {
      expect(attributes).not.toHaveProperty(WORKFLOW_ATTRIBUTES.runId);
    }
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
