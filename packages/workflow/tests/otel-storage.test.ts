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

import { createWorkflowEngine } from "../src/engine/create.ts";
import { createOpenTelemetryTelemetry } from "../src/otel.ts";
import {
  WORKFLOW_ATTRIBUTES,
  WORKFLOW_METRIC_NAMES,
  WORKFLOW_SPAN_NAMES,
  WORKFLOW_SYSTEM,
} from "../src/telemetry.ts";

describe("OpenTelemetry workflow storage telemetry", () => {
  afterEach(() => {
    trace.disable();
    metrics.disable();
  });

  test("emits storage operation spans and metrics without keys or values", async () => {
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
      telemetry: createOpenTelemetryTelemetry(),
    });

    await engine.storage.set("workflow:test", "value");
    await expect(engine.storage.get("")).rejects.toThrow("Storage key must be a non-empty string");
    await tracerProvider.forceFlush();
    await metricReader.forceFlush();

    const storageSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === WORKFLOW_SPAN_NAMES.storageOperation);
    expect(storageSpans.map((span) => span.attributes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.storageOperation]: "set",
          [WORKFLOW_ATTRIBUTES.storageBackend]: expect.any(String),
          [WORKFLOW_ATTRIBUTES.storageOperationStatus]: "success",
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.storageOperation]: "get",
          [WORKFLOW_ATTRIBUTES.storageBackend]: expect.any(String),
          [WORKFLOW_ATTRIBUTES.storageOperationStatus]: "failure",
        }),
      ]),
    );
    for (const span of storageSpans) {
      expect(span.attributes).not.toHaveProperty("storage.key");
      expect(span.attributes).not.toHaveProperty("workflow.storage.key");
      expect(span.attributes).not.toHaveProperty("workflow.storage.value");
    }
    expect(
      storageSpans.find(
        (span) => span.attributes[WORKFLOW_ATTRIBUTES.storageOperationStatus] === "failure",
      )?.status.code,
    ).toBe(SpanStatusCode.ERROR);

    const metricData = allMetricData(metricExporter);
    expect(metricData.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([
        WORKFLOW_METRIC_NAMES.storageOperationDuration,
        WORKFLOW_METRIC_NAMES.storageOperationErrors,
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.storageOperationDuration)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.storageOperation]: "set",
          [WORKFLOW_ATTRIBUTES.storageOperationStatus]: "success",
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.storageOperation]: "get",
          [WORKFLOW_ATTRIBUTES.storageOperationStatus]: "failure",
        }),
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.storageOperationErrors)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.storageOperation]: "get",
          [WORKFLOW_ATTRIBUTES.storageOperationStatus]: "failure",
        }),
      ]),
    );
    for (const attributes of allMetricAttributes(metricData)) {
      expect(attributes).not.toHaveProperty("storage.key");
      expect(attributes).not.toHaveProperty("workflow.storage.key");
      expect(attributes).not.toHaveProperty("workflow.storage.value");
    }
  });

  test("can record storage metrics without emitting storage operation spans", async () => {
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
      telemetry: createOpenTelemetryTelemetry({
        includeStorageOperationSpans: false,
      }),
    });

    await engine.storage.set("workflow:test", "value");
    await tracerProvider.forceFlush();
    await metricReader.forceFlush();

    expect(
      spanExporter
        .getFinishedSpans()
        .filter((span) => span.name === WORKFLOW_SPAN_NAMES.storageOperation),
    ).toEqual([]);
    expect(
      metricAttributes(
        allMetricData(metricExporter),
        WORKFLOW_METRIC_NAMES.storageOperationDuration,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.storageOperation]: "set",
          [WORKFLOW_ATTRIBUTES.storageOperationStatus]: "success",
        }),
      ]),
    );
  });
});

function allMetricData(exporter: InMemoryMetricExporter): readonly MetricData[] {
  return exporter
    .getMetrics()
    .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
    .flatMap((scopeMetrics) => scopeMetrics.metrics);
}

function allMetricAttributes(metricsData: readonly MetricData[]): readonly Attributes[] {
  return metricsData.flatMap((metric) => metric.dataPoints.map((point) => point.attributes));
}

function metricAttributes(
  metricsData: readonly MetricData[],
  metricName: string,
): readonly Attributes[] {
  return metricsData
    .filter((metric) => metric.descriptor.name === metricName)
    .flatMap((metric) => metric.dataPoints.map((point) => point.attributes));
}
