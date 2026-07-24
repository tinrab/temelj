import "./instrumentation.ts";
import { SpanStatusCode, metrics, trace, type Attributes, type Span } from "@opentelemetry/api";
import { createConsoleSink, createLogger, createMultiplexSink } from "@temelj/log";
import { createOpenTelemetryLogSink } from "@temelj/log/otel";
import {
  createWorkflowClient,
  getWorkflowFunctionDefinition,
  type CompiledWorkflowFunction,
  type WorkflowImplementation,
  type WorkflowRunHandle,
  type WorkflowStartOptions,
} from "@temelj/workflow";
import { createOpenTelemetryTelemetry } from "@temelj/workflow/otel";
import { performance } from "node:perf_hooks";

import type { CheckoutInput, NotificationInput } from "./compiled-workflows.ts";

import { checkoutWorkflow, notificationWorkflow } from "./compiled-workflows.ts";
import { otlpEndpoint, shutdownTelemetry } from "./instrumentation.ts";
import { reportWorkflow, type ReportInput } from "./workflows.ts";

interface BenchmarkResult {
  readonly batch: number;
  readonly durationMs: number;
  readonly runs: number;
  readonly startedAt: Date;
}

interface Scenario {
  readonly name: "checkout" | "report" | "notification";
  start(index: number, sequence: number): Promise<WorkflowRunHandle<unknown>>;
}

const runsPerScenario = readPositiveInteger("WORKFLOW_RUNS_PER_SCENARIO", 10);
const batchIntervalMs = readPositiveInteger("WORKFLOW_BATCH_INTERVAL_MS", 2_000);
const workerConcurrency = readPositiveInteger("WORKFLOW_WORKER_CONCURRENCY", 12);
const totalRunsPerBatch = runsPerScenario * 3;
const shutdown = new AbortController();

const tracer = trace.getTracer("temelj.workflow.example.basic", "0.1.0");
const meter = metrics.getMeter("temelj.workflow.example.basic", "0.1.0");
const runCounter = meter.createCounter("temelj.workflow.example.runs", {
  description: "Workflow example runs started by benchmark.",
});
const benchmarkDuration = meter.createHistogram("temelj.workflow.example.benchmark.duration", {
  description: "Benchmark scenario duration in milliseconds.",
  unit: "ms",
});
const workflowResultDuration = meter.createHistogram("temelj.workflow.example.result.duration", {
  description: "End-to-end workflow result wait duration in milliseconds.",
  unit: "ms",
});
const batchCounter = meter.createCounter("temelj.workflow.example.batches", {
  description: "Completed workflow traffic batches.",
});
const batchLag = meter.createHistogram("temelj.workflow.example.batch.lag", {
  description: "Milliseconds a traffic batch exceeded the configured interval.",
  unit: "ms",
});

const client = createWorkflowClient({
  logger: createLogger({
    sink: createMultiplexSink([
      createConsoleSink(),
      createOpenTelemetryLogSink({ emitLogs: true }),
    ]),
  }),
  telemetry: createOpenTelemetryTelemetry({
    includeNamesInSpanNames: true,
    includeStorageOperationSpans: false,
    includeStepNameMetricAttribute: true,
    serviceNamespace: "temelj-examples",
  }),
});
client.register(reportWorkflow);

process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

try {
  await runLoadGenerator(shutdown.signal);
} finally {
  await client.close();
  await shutdownTelemetry();
}

async function runLoadGenerator(signal: AbortSignal): Promise<void> {
  console.log(`Sending workflow metrics and traces to ${otlpEndpoint}`);
  console.log(
    [
      `Running ${totalRunsPerBatch} workflows every ${batchIntervalMs}ms`,
      `(${runsPerScenario} checkout, ${runsPerScenario} report, ${runsPerScenario} notification)`,
      `with worker concurrency ${workerConcurrency}. Press Ctrl+C to stop.`,
    ].join(" "),
  );

  let batch = 0;
  let sequence = 0;
  while (!signal.aborted) {
    const batchStartedAt = performance.now();
    const result = await runBatch(batch, sequence, signal);
    sequence += totalRunsPerBatch;
    printSummary(result);

    const elapsedMs = performance.now() - batchStartedAt;
    const lagMs = Math.max(0, elapsedMs - batchIntervalMs);
    if (lagMs > 0) {
      batchLag.record(lagMs);
    }

    batch++;
    await sleep(Math.max(0, batchIntervalMs - elapsedMs), signal);
  }
}

async function runBatch(
  batch: number,
  sequenceOffset: number,
  signal: AbortSignal,
): Promise<BenchmarkResult> {
  const worker = client.workers.create({ workerId: "workflow-basic-worker" });
  const startedAt = new Date();
  const startedAtMs = performance.now();

  return await withSpan(`workflow-example.batch`, async (span) => {
    span.setAttribute("workflow.example.batch", batch);
    span.setAttribute("workflow.example.runs_per_scenario", runsPerScenario);
    span.setAttribute("workflow.example.runs_per_batch", totalRunsPerBatch);
    span.setAttribute("workflow.worker.concurrency", workerConcurrency);

    const handles: Array<{
      readonly scenario: string;
      readonly handle: WorkflowRunHandle<unknown>;
    }> = [];

    for (const scenario of scenarios()) {
      await withSpan(`workflow-example.start.${scenario.name}`, async (startSpan) => {
        startSpan.setAttribute("workflow.example.batch", batch);
        startSpan.setAttribute("benchmark.name", scenario.name);
        startSpan.setAttribute("benchmark.runs", runsPerScenario);

        for (let index = 0; index < runsPerScenario; index++) {
          if (signal.aborted) {
            break;
          }
          const sequence = sequenceOffset + handles.length;
          handles.push({
            scenario: scenario.name,
            handle: await scenario.start(index, sequence),
          });
          runCounter.add(1, attributesForScenario(scenario.name));
        }
      });
    }

    await worker.run({
      concurrency: workerConcurrency,
      maxRuns: handles.length,
      pollInterval: Temporal.Duration.from({ milliseconds: 10 }),
    });
    await waitForResults(handles);

    const durationMs = performance.now() - startedAtMs;
    benchmarkDuration.record(durationMs, { "benchmark.name": "batch" });
    batchCounter.add(1);
    span.setAttribute("workflow.example.completed_runs", handles.length);
    span.setAttribute("workflow.example.duration_ms", durationMs);

    return {
      batch,
      durationMs,
      runs: handles.length,
      startedAt,
    };
  });
}

function scenarios(): readonly Scenario[] {
  return [
    {
      name: "checkout",
      start: async (index: number, sequence: number) =>
        await startCompiledWorkflow(checkoutWorkflow, [checkoutInput(index)], {
          idempotencyKey: `checkout-${sequence}`,
        }),
    },
    {
      name: "report",
      start: async (index: number, sequence: number) =>
        await client.runs.start(reportWorkflow, reportInput(index), {
          idempotencyKey: `report-${sequence}`,
        }),
    },
    {
      name: "notification",
      start: async (index: number, sequence: number) =>
        await startCompiledWorkflow(notificationWorkflow, [notificationInput(index)], {
          idempotencyKey: `notification-${sequence}`,
        }),
    },
  ] as const;
}

async function waitForResults(
  handles: readonly {
    readonly scenario: string;
    readonly handle: WorkflowRunHandle<unknown>;
  }[],
): Promise<void> {
  await Promise.all(
    handles.map(async ({ handle, scenario }) => {
      const startedAt = performance.now();
      await handle.result();
      workflowResultDuration.record(performance.now() - startedAt, attributesForScenario(scenario));
    }),
  );
}

function checkoutInput(index: number): CheckoutInput {
  return {
    orderId: `order_${index.toString().padStart(3, "0")}`,
    items: 1 + (index % 5),
    customerTier: index % 3 === 0 ? "priority" : "standard",
  };
}

function reportInput(index: number): ReportInput {
  return {
    reportId: `report_${index.toString().padStart(3, "0")}`,
    rows: 10_000 + index * 1_000,
  };
}

function notificationInput(index: number): NotificationInput {
  return {
    incidentId: `incident_${index.toString().padStart(3, "0")}`,
    recipients: [
      `primary-${index}@example.test`,
      `secondary-${index}@example.test`,
      `ops-${index}@example.test`,
    ],
  };
}

function attributesForScenario(name: string): Attributes {
  return {
    "benchmark.name": name,
  };
}

// TODO: Consider ergonomics
async function startCompiledWorkflow<TArgs extends readonly unknown[], TOutput>(
  workflow: CompiledWorkflowFunction<TArgs, TOutput>,
  args: TArgs,
  options?: WorkflowStartOptions,
): Promise<WorkflowRunHandle<Awaited<TOutput>>> {
  const implementation = requireCompiledWorkflowDefinition(workflow);
  client.register(implementation);
  return await client.runs.start(implementation.definition, args, options);
}

function requireCompiledWorkflowDefinition<TArgs extends readonly unknown[], TOutput>(
  workflow: CompiledWorkflowFunction<TArgs, TOutput>,
): WorkflowImplementation<TArgs, Awaited<TOutput>, TArgs> {
  const definition = getWorkflowFunctionDefinition(workflow);
  if (definition === undefined) {
    throw new Error("Expected Rolldown workflow plugin to attach compiled workflow metadata");
  }
  return definition;
}

async function withSpan<T>(name: string, callback: (span: Span) => Promise<T>): Promise<T> {
  return await tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await callback(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0 || signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requestShutdown(signalName: string): void {
  console.log(`Received ${signalName}; flushing telemetry and stopping.`);
  shutdown.abort();
}

function printSummary(result: BenchmarkResult): void {
  console.log(
    [
      result.startedAt.toISOString(),
      `batch=${result.batch}`,
      `runs=${result.runs}`,
      `durationMs=${result.durationMs.toFixed(2)}`,
    ].join(" "),
  );
}
