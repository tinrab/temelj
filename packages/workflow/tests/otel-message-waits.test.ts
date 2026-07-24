import type { Attributes, Span } from "@opentelemetry/api";
import type { MetricData } from "@opentelemetry/sdk-metrics";

import { metrics, trace } from "@opentelemetry/api";
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

import type { EventRecord } from "../src/types/events.ts";
import type { Telemetry, TelemetryContext } from "../src/types/telemetry.ts";

import { implementWorkflow } from "../src/definition.ts";
import { createWorkflowEngine } from "../src/engine/create.ts";
import { createOpenTelemetryTelemetry } from "../src/otel.ts";
import {
  WORKFLOW_ATTRIBUTES,
  WORKFLOW_METRIC_NAMES,
  WORKFLOW_SPAN_NAMES,
  WORKFLOW_SYSTEM,
} from "../src/telemetry.ts";

describe("OpenTelemetry workflow message wait telemetry", () => {
  afterEach(() => {
    trace.disable();
    metrics.disable();
  });

  test("emits message and hook wait latency metrics from durable history", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter });
    const meterProvider = new MeterProvider({ readers: [metricReader] });
    trace.setGlobalTracerProvider(tracerProvider);
    metrics.setGlobalMeterProvider(meterProvider);
    const tracer = trace.getTracer("workflow-test");

    let now = Temporal.Instant.from("2026-06-15T10:00:00Z");
    let forcedTraceContext: TelemetryContext | undefined;
    const otelTelemetry = createOpenTelemetryTelemetry();
    const telemetry: Telemetry = {
      bindEngine: (currentEngine) => {
        otelTelemetry.bindEngine?.(currentEngine);
      },
      captureContext: () => forcedTraceContext ?? otelTelemetry.captureContext?.(),
      observe: (name, payload) => {
        otelTelemetry.observe?.(name, payload);
      },
      recordRunExecution: (telemetryContext) => {
        otelTelemetry.recordRunExecution?.(telemetryContext);
      },
      recordStepExecution: (telemetryContext) => {
        otelTelemetry.recordStepExecution?.(telemetryContext);
      },
      shutdown: async () => {
        await otelTelemetry.shutdown?.();
      },
      withRunExecution: async (telemetryContext, callback) =>
        await (otelTelemetry.withRunExecution?.(telemetryContext, callback) ?? callback()),
      withStepExecution: async (telemetryContext, callback) =>
        await (otelTelemetry.withStepExecution?.(telemetryContext, callback) ?? callback()),
    };
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run-otel-message-latency", "run-otel-hook-latency"),
      now: () => now,
      telemetry,
    });
    const messageWorkflow = implementWorkflow(
      { name: "otel-message-latency" },
      async ({ step }) => await step.message.wait({ messageId: "ready" }),
    );

    await expect(engine.runWorkflowNow(messageWorkflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-15T10:00:05Z");
    let messageSendTraceId = "";
    await tracer.startActiveSpan("external-message-send", async (span) => {
      messageSendTraceId = span.spanContext().traceId;
      forcedTraceContext = traceContextFromSpan(span);
      await engine.sendMessage("run-otel-message-latency", { messageId: "ready" });
      forcedTraceContext = undefined;
      span.end();
    });
    now = Temporal.Instant.from("2026-06-15T10:00:06Z");
    await expect(
      engine.resumeWorkflow(messageWorkflow, "run-otel-message-latency"),
    ).resolves.toMatchObject({
      kind: "completed",
    });

    let hookToken = "";
    const hookWorkflow = implementWorkflow({ name: "otel-hook-latency" }, async ({ step }) => {
      const hook = step.hook.create({ name: "approved" });
      hookToken = hook.token;
      return await hook;
    });
    now = Temporal.Instant.from("2026-06-15T10:01:00Z");
    await expect(engine.runWorkflowNow(hookWorkflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-15T10:01:03Z");
    let hookResumeTraceId = "";
    await tracer.startActiveSpan("external-hook-resume", async (span) => {
      hookResumeTraceId = span.spanContext().traceId;
      forcedTraceContext = traceContextFromSpan(span);
      await engine.resumeHook(hookToken, { payload: "ok" });
      forcedTraceContext = undefined;
      span.end();
    });
    now = Temporal.Instant.from("2026-06-15T10:01:04Z");
    await expect(
      engine.resumeWorkflow(hookWorkflow, "run-otel-hook-latency"),
    ).resolves.toMatchObject({
      kind: "completed",
      output: "ok",
    });
    await tracerProvider.forceFlush();
    await metricReader.forceFlush();

    const spans = spanExporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        WORKFLOW_SPAN_NAMES.messageSend,
        WORKFLOW_SPAN_NAMES.messageWait,
        WORKFLOW_SPAN_NAMES.hookResume,
      ]),
    );
    const messageWaitSpan = spans.find(
      (span) =>
        span.name === WORKFLOW_SPAN_NAMES.messageWait &&
        span.attributes[WORKFLOW_ATTRIBUTES.messageSource] === "message",
    );
    const hookWaitSpan = spans.find(
      (span) =>
        span.name === WORKFLOW_SPAN_NAMES.messageWait &&
        span.attributes[WORKFLOW_ATTRIBUTES.messageSource] === "hook",
    );
    expect(messageWaitSpan?.links.map((link) => link.context.traceId)).toContain(
      messageSendTraceId,
    );
    expect(hookWaitSpan?.links.map((link) => link.context.traceId)).toContain(hookResumeTraceId);

    const metricData = allMetricData(metricExporter);
    expect(metricData.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([
        WORKFLOW_METRIC_NAMES.messageWaitLatency,
        WORKFLOW_METRIC_NAMES.hookResumeLatency,
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.messageWaitLatency)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.messageSource]: "message",
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.messageSource]: "hook",
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        }),
      ]),
    );
    expect(metricAttributes(metricData, WORKFLOW_METRIC_NAMES.hookResumeLatency)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.hookKind]: "hook",
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        }),
      ]),
    );
  });

  test("ignores malformed trace context when linking message wait spans", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    const telemetry = createOpenTelemetryTelemetry();
    const startedAt = Temporal.Instant.from("2026-06-15T10:00:00Z");
    const messageAt = Temporal.Instant.from("2026-06-15T10:00:05Z");
    const completedAt = Temporal.Instant.from("2026-06-15T10:00:06Z");
    const invalidTraceContext = {
      traceparent: "00-00000000000000000000000000000000-0000000000000000-01",
    };
    const started = {
      kind: "message_wait_started",
      timestamp: startedAt,
      stepId: "message:ready",
      stepName: "ready",
      count: 1,
      messageId: "ready",
    } satisfies Extract<EventRecord, { readonly kind: "message_wait_started" }>;
    const sent = {
      kind: "message_sent",
      timestamp: messageAt,
      messageId: "ready",
      telemetryContext: invalidTraceContext,
    } satisfies Extract<EventRecord, { readonly kind: "message_sent" }>;
    const completed = {
      kind: "message_wait_completed",
      timestamp: completedAt,
      stepId: "message:ready",
      stepName: "ready",
      messageId: "ready",
      messageTimestamp: messageAt,
      telemetryContext: invalidTraceContext,
    } satisfies Extract<EventRecord, { readonly kind: "message_wait_completed" }>;

    telemetry.observe?.("workflow:durable-event-appended", {
      runId: "run-invalid-trace-link",
      event: completed,
      events: [started, sent, completed],
    });
    await tracerProvider.forceFlush();

    const messageWaitSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === WORKFLOW_SPAN_NAMES.messageWait);
    expect(messageWaitSpan?.links).toEqual([]);
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

function traceContextFromSpan(span: Span): TelemetryContext {
  const spanContext = span.spanContext();
  return {
    traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`,
  };
}
