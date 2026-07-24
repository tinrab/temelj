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
import { Registry } from "../src/registry.ts";
import {
  WORKFLOW_ATTRIBUTES,
  WORKFLOW_METRIC_NAMES,
  WORKFLOW_SPAN_NAMES,
  WORKFLOW_SYSTEM,
} from "../src/telemetry.ts";
import { WorkflowWorker } from "../src/worker.ts";

describe("OpenTelemetry workflow worker telemetry", () => {
  afterEach(() => {
    trace.disable();
    metrics.disable();
  });

  test("uses workflow semantic conventions for claimed worker spans", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    const engine = createWorkflowEngine({
      createRunId: () => "run-otel-worker",
      now: () => Temporal.Instant.from("2026-06-15T10:00:00Z"),
      telemetry: createOpenTelemetryTelemetry(),
    });
    const workflow = implementWorkflow({ name: "otel-worker" }, () => "done");

    await engine.runWorkflow(workflow, undefined);
    await engine.store.claimRun({
      leaseDuration: Temporal.Duration.from({ minutes: 1 }),
      now: Temporal.Instant.from("2026-06-15T10:00:01Z"),
      runId: "run-otel-worker",
      workerId: "worker_otel",
    });
    await expect(engine.resumeWorkflow(workflow, "run-otel-worker")).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await tracerProvider.forceFlush();

    const runSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === WORKFLOW_SPAN_NAMES.runExecution);

    expect(runSpan?.attributes).toEqual(
      expect.objectContaining({
        [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        [WORKFLOW_ATTRIBUTES.workerId]: "worker_otel",
      }),
    );
    expect(runSpan?.attributes).not.toHaveProperty("worker.id");
  });

  test("emits operational worker handoff and retry metrics", async () => {
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter });
    const meterProvider = new MeterProvider({ readers: [metricReader] });
    metrics.setGlobalMeterProvider(meterProvider);

    let now = Temporal.Instant.from("2026-06-15T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run-otel-claim", "run-otel-retry"),
      now: () => now,
      telemetry: createOpenTelemetryTelemetry(),
    });
    const registry = new Registry();
    const claimWorkflow = implementWorkflow({ name: "otel-claim-metrics" }, () => "done");
    registry.register(claimWorkflow);
    const worker = new WorkflowWorker({
      engine,
      now: () => now,
      registry,
      workerId: "worker_metrics",
    });

    await engine.runWorkflow(claimWorkflow, undefined);
    now = Temporal.Instant.from("2026-06-15T10:00:05Z");
    await expect(worker.processRun("run-otel-claim")).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    const retryWorkflow = implementWorkflow(
      {
        name: "otel-retry-metrics",
        retry: { maximumAttempts: 2, initialInterval: Temporal.Duration.from({ seconds: 10 }) },
      },
      () => {
        throw new Error("retry later");
      },
    );
    now = Temporal.Instant.from("2026-06-15T10:01:00Z");
    await expect(engine.runWorkflowNow(retryWorkflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-15T10:01:15Z");
    await expect(engine.resumeWorkflow(retryWorkflow, "run-otel-retry")).resolves.toMatchObject({
      kind: "failed",
    });
    await metricReader.forceFlush();

    const metricData = allMetricData(metricExporter);
    expect(metricData.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([
        WORKFLOW_METRIC_NAMES.workerActiveExecutions,
        WORKFLOW_METRIC_NAMES.workerClaims,
        WORKFLOW_METRIC_NAMES.pendingToClaimedLatency,
        WORKFLOW_METRIC_NAMES.retryExhausted,
        WORKFLOW_METRIC_NAMES.retryScheduled,
        WORKFLOW_METRIC_NAMES.retryDelay,
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.workerClaims)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.workflowName]: "otel-claim-metrics",
          [WORKFLOW_ATTRIBUTES.runTransition]: "claimed",
          [WORKFLOW_ATTRIBUTES.workerOperation]: "claimed",
        }),
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.retryScheduled)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.workflowName]: "otel-retry-metrics",
          [WORKFLOW_ATTRIBUTES.retryReason]: "workflow",
          [WORKFLOW_ATTRIBUTES.runTransition]: "retry",
        }),
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.retryExhausted)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.workflowName]: "otel-retry-metrics",
          [WORKFLOW_ATTRIBUTES.retryExhausted]: true,
          [WORKFLOW_ATTRIBUTES.retryReason]: "workflow",
          [WORKFLOW_ATTRIBUTES.runTransition]: "failed",
        }),
      ]),
    );
  });

  test("emits worker failure and lease operation metrics and spans", async () => {
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
    const timestamp = Temporal.Instant.from("2026-06-15T10:00:00Z");
    engine.observeWorkerOperation({
      operation: "claim",
      status: "failure",
      timestamp,
      workerId: "worker_metrics",
      runId: "run_missing",
      error: new Error("claim failed"),
    });
    engine.observeWorkerOperation({
      operation: "heartbeat",
      status: "failure",
      timestamp,
      workerId: "worker_metrics",
      runId: "run_lost",
      error: new Error("heartbeat failed"),
    });
    engine.observeWorkerOperation({
      operation: "lease_extension",
      status: "success",
      timestamp,
      workerId: "worker_metrics",
      runId: "run_lease",
    });
    engine.observeWorkerOperation({
      operation: "lease_release",
      status: "failure",
      timestamp,
      workerId: "worker_metrics",
      runId: "run_lease",
    });
    await tracerProvider.forceFlush();
    await metricReader.forceFlush();

    const metricData = allMetricData(metricExporter);
    expect(metricData.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([
        WORKFLOW_METRIC_NAMES.workerClaimFailures,
        WORKFLOW_METRIC_NAMES.workerHeartbeatFailures,
        WORKFLOW_METRIC_NAMES.workerLeaseExtensions,
        WORKFLOW_METRIC_NAMES.workerLeaseReleases,
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.workerClaimFailures)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.workerOperation]: "claim",
          [WORKFLOW_ATTRIBUTES.workerOperationStatus]: "failure",
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        }),
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.workerLeaseExtensions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.workerOperation]: "lease_extension",
          [WORKFLOW_ATTRIBUTES.workerOperationStatus]: "success",
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        }),
      ]),
    );

    const workerSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === WORKFLOW_SPAN_NAMES.workerOperation);
    expect(workerSpans).toHaveLength(4);
    expect(workerSpans.map((span) => span.attributes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.workerId]: "worker_metrics",
          [WORKFLOW_ATTRIBUTES.runId]: "run_missing",
          [WORKFLOW_ATTRIBUTES.workerOperation]: "claim",
          [WORKFLOW_ATTRIBUTES.workerOperationStatus]: "failure",
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.workerId]: "worker_metrics",
          [WORKFLOW_ATTRIBUTES.runId]: "run_lease",
          [WORKFLOW_ATTRIBUTES.workerOperation]: "lease_extension",
          [WORKFLOW_ATTRIBUTES.workerOperationStatus]: "success",
        }),
      ]),
    );
    const claimFailureSpan = workerSpans.find(
      (span) => span.attributes[WORKFLOW_ATTRIBUTES.workerOperation] === "claim",
    );
    expect(claimFailureSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(exceptionMessages(claimFailureSpan)).toContain("claim failed");
  });

  test("emits worker poll operation spans", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    const engine = createWorkflowEngine({
      createRunId: () => "run-otel-worker-poll",
      now: fixedClock([
        "2026-06-15T10:00:00Z",
        "2026-06-15T10:00:01Z",
        "2026-06-15T10:00:02Z",
        "2026-06-15T10:00:03Z",
      ]),
      telemetry: createOpenTelemetryTelemetry(),
    });
    const registry = new Registry();
    const workflow = implementWorkflow({ name: "otel-worker-poll" }, () => "done");
    registry.register(workflow);
    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_poll",
    });

    await expect(worker.processNextRun()).resolves.toBeUndefined();
    await engine.runWorkflow(workflow, undefined);
    await expect(worker.processNextRun()).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await tracerProvider.forceFlush();

    const pollSpans = spanExporter
      .getFinishedSpans()
      .filter(
        (span) =>
          span.name === WORKFLOW_SPAN_NAMES.workerOperation &&
          span.attributes[WORKFLOW_ATTRIBUTES.workerOperation] === "poll",
      );
    expect(pollSpans.map((span) => span.attributes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.workerId]: "worker_poll",
          [WORKFLOW_ATTRIBUTES.workerOperation]: "poll",
          [WORKFLOW_ATTRIBUTES.workerOperationStatus]: "empty",
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.workerId]: "worker_poll",
          [WORKFLOW_ATTRIBUTES.workerOperation]: "poll",
          [WORKFLOW_ATTRIBUTES.workerOperationStatus]: "claimed",
          [WORKFLOW_ATTRIBUTES.runId]: "run-otel-worker-poll",
          [WORKFLOW_ATTRIBUTES.workflowName]: "otel-worker-poll",
          [WORKFLOW_ATTRIBUTES.runStatus]: "running",
        }),
      ]),
    );
    expect(pollSpans.map((span) => span.status.code)).toEqual([
      SpanStatusCode.OK,
      SpanStatusCode.OK,
    ]);
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
