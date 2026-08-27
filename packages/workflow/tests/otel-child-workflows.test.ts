import type {
  Context,
  ContextManager,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
} from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

import {
  ROOT_CONTEXT,
  SpanStatusCode,
  TraceFlags,
  context,
  propagation,
  trace,
} from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { isPromise } from "@temelj/value";
import { afterEach, describe, expect, test } from "vitest";

import { implementWorkflow } from "../src/definition.ts";
import { createWorkflowEngine } from "../src/engine/create.ts";
import { createOpenTelemetryTelemetry } from "../src/otel.ts";
import { WORKFLOW_ATTRIBUTES, WORKFLOW_SPAN_NAMES, WORKFLOW_SYSTEM } from "../src/telemetry.ts";

describe("OpenTelemetry child workflow telemetry", () => {
  afterEach(() => {
    context.disable();
    propagation.disable();
    trace.disable();
  });

  test("emits child workflow operation spans with shared trace lineage", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    context.setGlobalContextManager(new TestContextManager());
    propagation.setGlobalPropagator(new TestTraceContextPropagator());
    trace.setGlobalTracerProvider(tracerProvider);

    let now = Temporal.Instant.from("2026-06-15T10:00:00Z");
    const runIds = ["run-otel-parent", "run-otel-child"];
    const engine = createWorkflowEngine({
      createRunId: () => runIds.shift() ?? "run-otel-extra",
      now: () => now,
      telemetry: createOpenTelemetryTelemetry(),
    });
    const child = implementWorkflow({ name: "otel-child", version: "v1" }, () => {
      return "child-output";
    });
    const parent = implementWorkflow({ name: "otel-parent", version: "v1" }, async ({ step }) => {
      return await step.workflow.run(child, undefined, { name: "child" });
    });

    await expect(engine.runWorkflowNow(parent, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-15T10:00:01Z");
    await expect(engine.resumeWorkflow(child, "run-otel-child")).resolves.toMatchObject({
      kind: "completed",
      output: "child-output",
    });
    now = Temporal.Instant.from("2026-06-15T10:00:02Z");
    await expect(engine.resumeWorkflow(parent, "run-otel-parent")).resolves.toMatchObject({
      kind: "completed",
      output: "child-output",
    });
    await tracerProvider.forceFlush();

    const spans = spanExporter.getFinishedSpans();
    const childWorkflowSpans = spans.filter(
      (span) => span.name === WORKFLOW_SPAN_NAMES.childWorkflowOperation,
    );
    expect(childWorkflowSpans.map((span) => span.attributes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.runId]: "run-otel-parent",
          [WORKFLOW_ATTRIBUTES.stepId]: "workflow:child",
          [WORKFLOW_ATTRIBUTES.stepName]: "child",
          [WORKFLOW_ATTRIBUTES.stepKind]: "workflow",
          [WORKFLOW_ATTRIBUTES.stepAttempt]: 1,
          [WORKFLOW_ATTRIBUTES.childWorkflowOperation]: "start",
          [WORKFLOW_ATTRIBUTES.childWorkflowRunId]: "run-otel-child",
          [WORKFLOW_ATTRIBUTES.childWorkflowName]: "otel-child",
          [WORKFLOW_ATTRIBUTES.childWorkflowVersion]: "v1",
          [WORKFLOW_ATTRIBUTES.childWorkflowStatus]: "started",
        }),
        expect.objectContaining({
          [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
          [WORKFLOW_ATTRIBUTES.runId]: "run-otel-parent",
          [WORKFLOW_ATTRIBUTES.stepId]: "workflow:child",
          [WORKFLOW_ATTRIBUTES.stepName]: "child",
          [WORKFLOW_ATTRIBUTES.childWorkflowOperation]: "complete",
          [WORKFLOW_ATTRIBUTES.childWorkflowRunId]: "run-otel-child",
          [WORKFLOW_ATTRIBUTES.childWorkflowName]: "otel-child",
          [WORKFLOW_ATTRIBUTES.childWorkflowVersion]: "v1",
          [WORKFLOW_ATTRIBUTES.childWorkflowStatus]: "completed",
          [WORKFLOW_ATTRIBUTES.childWorkflowDurationMs]: 2000,
        }),
      ]),
    );
    expect(childWorkflowSpans.map((span) => span.status.code)).toEqual([
      SpanStatusCode.OK,
      SpanStatusCode.OK,
    ]);

    const parentRunSpan = spans.find(
      (span) =>
        span.name === WORKFLOW_SPAN_NAMES.runExecution &&
        span.attributes[WORKFLOW_ATTRIBUTES.runId] === "run-otel-parent",
    );
    const childRunSpan = spans.find(
      (span) =>
        span.name === WORKFLOW_SPAN_NAMES.runExecution &&
        span.attributes[WORKFLOW_ATTRIBUTES.runId] === "run-otel-child",
    );
    expect(parentRunSpan?.spanContext().traceId).toBeDefined();
    expect(childRunSpan?.spanContext().traceId).toBe(parentRunSpan?.spanContext().traceId);
  });

  test("emits failed child workflow operation spans", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    context.setGlobalContextManager(new TestContextManager());
    propagation.setGlobalPropagator(new TestTraceContextPropagator());
    trace.setGlobalTracerProvider(tracerProvider);

    let now = Temporal.Instant.from("2026-06-15T10:00:00Z");
    const runIds = ["run-otel-failing-parent", "run-otel-failing-child"];
    const engine = createWorkflowEngine({
      createRunId: () => runIds.shift() ?? "run-otel-extra",
      now: () => now,
      telemetry: createOpenTelemetryTelemetry(),
    });
    const child = implementWorkflow({ name: "otel-failing-child" }, () => {
      throw new Error("child exploded");
    });
    const parent = implementWorkflow({ name: "otel-failing-parent" }, async ({ step }) => {
      return await step.workflow.run(child, undefined, { name: "child" });
    });

    await expect(engine.runWorkflowNow(parent, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-15T10:00:01Z");
    await expect(engine.resumeWorkflow(child, "run-otel-failing-child")).resolves.toMatchObject({
      kind: "failed",
    });
    now = Temporal.Instant.from("2026-06-15T10:00:02Z");
    await expect(engine.resumeWorkflow(parent, "run-otel-failing-parent")).resolves.toMatchObject({
      kind: "failed",
    });
    await tracerProvider.forceFlush();

    const failedSpan = spanExporter
      .getFinishedSpans()
      .find(
        (span) =>
          span.name === WORKFLOW_SPAN_NAMES.childWorkflowOperation &&
          span.attributes[WORKFLOW_ATTRIBUTES.childWorkflowOperation] === "fail",
      );
    expect(failedSpan?.attributes).toEqual(
      expect.objectContaining({
        [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
        [WORKFLOW_ATTRIBUTES.runId]: "run-otel-failing-parent",
        [WORKFLOW_ATTRIBUTES.stepId]: "workflow:child",
        [WORKFLOW_ATTRIBUTES.stepName]: "child",
        [WORKFLOW_ATTRIBUTES.stepKind]: "workflow",
        [WORKFLOW_ATTRIBUTES.stepAttempt]: 1,
        [WORKFLOW_ATTRIBUTES.childWorkflowOperation]: "fail",
        [WORKFLOW_ATTRIBUTES.childWorkflowRunId]: "run-otel-failing-child",
        [WORKFLOW_ATTRIBUTES.childWorkflowName]: "otel-failing-child",
        [WORKFLOW_ATTRIBUTES.childWorkflowStatus]: "failed",
        [WORKFLOW_ATTRIBUTES.childWorkflowDurationMs]: 1000,
        [WORKFLOW_ATTRIBUTES.errorKind]: "Error",
      }),
    );
    expect(failedSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(exceptionMessages(failedSpan)).toContain("child exploded");
  });
});

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
      if (isPromise(result)) {
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
