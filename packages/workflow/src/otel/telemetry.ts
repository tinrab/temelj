import {
  SpanStatusCode,
  context,
  metrics,
  propagation,
  trace,
  type Attributes,
  type ObservableGauge,
} from "@opentelemetry/api";

import type { ObservationEventArgs } from "../types/observation.ts";
import type { ExecutionResult } from "../types/result.ts";
import type { WorkflowLifecycleEvent } from "../types/run.ts";
import type {
  RunTelemetryContext,
  RunTelemetryResultContext,
  StepTelemetryContext,
  StorageTelemetryContext,
  Telemetry,
  TelemetryContext,
  TelemetryEngine,
} from "../types/telemetry.ts";

import { omitUndefined } from "../collection.ts";
import { getEventDescriptor } from "../events/descriptors.ts";
import { History } from "../history/replay.ts";
import {
  WORKFLOW_ATTRIBUTES,
  WORKFLOW_INSTRUMENTATION_NAME,
  WORKFLOW_INSTRUMENTATION_VERSION,
  WORKFLOW_METRIC_NAMES,
  WORKFLOW_SPAN_NAMES,
  WORKFLOW_SYSTEM,
} from "../telemetry.ts";
import { optionalDurationBetweenMilliseconds } from "../temporal.ts";
import { createInstruments } from "./metrics.ts";
import { SpanRecorder } from "./spans.ts";
import {
  contextFromTraceContext,
  streamStatusFromEventKind,
  recordResultOnSpan,
  withSpanStatus,
} from "./support.ts";

export interface OpenTelemetryWorkflowTelemetryOptions {
  readonly serviceNamespace?: string;
  readonly includeStepNameMetricAttribute?: boolean;
  /**
   * Adds workflow and step names to span names so trace UIs can distinguish rows
   * even when they do not show attributes by default.
   */
  readonly includeNamesInSpanNames?: boolean;
  /**
   * Emits a span around every workflow storage/backend operation.
   * Disable this in demos or high-volume services when these low-level spans
   * drown out workflow run and step spans in trace search results.
   */
  readonly includeStorageOperationSpans?: boolean;
  /**
   * Optional callback used by `Telemetry.shutdown` to flush SDK processors/exporters.
   * Pass your tracer or meter provider's `forceFlush` when the workflow engine owns shutdown.
   */
  readonly forceFlush?: () => Promise<void> | void;
  /**
   * Optional callback used by `Telemetry.shutdown` to release SDK resources.
   * The adapter stays SDK-agnostic, so provider shutdown is supplied by the caller.
   */
  readonly shutdown?: () => Promise<void> | void;
}

export function createOpenTelemetryTelemetry(
  options: OpenTelemetryWorkflowTelemetryOptions = {},
): Telemetry {
  return new OpenTelemetryTelemetry(options);
}

class OpenTelemetryTelemetry implements Telemetry {
  readonly #tracer = trace.getTracer(
    WORKFLOW_INSTRUMENTATION_NAME,
    WORKFLOW_INSTRUMENTATION_VERSION,
  );
  readonly #meter = metrics.getMeter(
    WORKFLOW_INSTRUMENTATION_NAME,
    WORKFLOW_INSTRUMENTATION_VERSION,
  );
  readonly #options: OpenTelemetryWorkflowTelemetryOptions;
  readonly #metrics = createInstruments(this.#meter);
  readonly #spans = new SpanRecorder(this.#tracer, this.#metrics, (attributes) =>
    this.#attributes(attributes),
  );

  readonly #runGauge: ObservableGauge;
  readonly #workerActiveExecutionsGauge: ObservableGauge;

  #engine?: TelemetryEngine;

  constructor(options: OpenTelemetryWorkflowTelemetryOptions) {
    this.#options = options;
    this.#runGauge = this.#meter.createObservableGauge(WORKFLOW_METRIC_NAMES.runs, {
      description: "Current count of workflow runs by status.",
    });
    this.#workerActiveExecutionsGauge = this.#meter.createObservableGauge(
      WORKFLOW_METRIC_NAMES.workerActiveExecutions,
      {
        description: "Current count of workflow runs actively held by workers.",
      },
    );
    this.#runGauge.addCallback(async (result) => {
      if (this.#engine?.getRunSummary === undefined) {
        return;
      }

      try {
        const summary = await this.#engine.getRunSummary();

        for (const [status, count] of Object.entries(summary.status)) {
          result.observe(count, this.#attributes({ [WORKFLOW_ATTRIBUTES.runStatus]: status }));
        }
      } catch {
        return;
      }
    });
    this.#workerActiveExecutionsGauge.addCallback(async (result) => {
      if (this.#engine?.getRunSummary === undefined) {
        return;
      }

      try {
        const summary = await this.#engine.getRunSummary();
        result.observe(
          summary.status.running,
          this.#attributes({ [WORKFLOW_ATTRIBUTES.runStatus]: "running" }),
        );
      } catch {
        return;
      }
    });
  }

  captureContext(): TelemetryContext | undefined {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);

    return Object.keys(carrier).length === 0
      ? undefined
      : omitUndefined({ traceparent: carrier.traceparent, tracestate: carrier.tracestate });
  }

  async withRunExecution<T extends ExecutionResult>(
    telemetryContext: RunTelemetryContext,
    callback: () => Promise<T>,
  ): Promise<T> {
    const parent = contextFromTraceContext(telemetryContext.traceContext);

    return await this.#tracer.startActiveSpan(
      this.#runExecutionSpanName(telemetryContext),
      {
        attributes: this.#attributes({
          [WORKFLOW_ATTRIBUTES.workflowName]: telemetryContext.run.workflowName,
          [WORKFLOW_ATTRIBUTES.workflowVersion]: telemetryContext.run.workflowVersion,
          [WORKFLOW_ATTRIBUTES.runId]: telemetryContext.run.id,
          [WORKFLOW_ATTRIBUTES.namespace]: telemetryContext.run.namespace,
          [WORKFLOW_ATTRIBUTES.runAttempt]: telemetryContext.run.attempts,
          [WORKFLOW_ATTRIBUTES.workerId]: telemetryContext.run.workerId,
        }),
      },
      parent,
      (span) =>
        withSpanStatus(span, callback, { onSuccess: (result) => recordResultOnSpan(span, result) }),
    );
  }

  async withStepExecution<T>(
    telemetryContext: StepTelemetryContext,
    callback: () => Promise<T>,
  ): Promise<T> {
    return await this.#tracer.startActiveSpan(
      this.#stepExecutionSpanName(telemetryContext),
      {
        attributes: this.#attributes({
          [WORKFLOW_ATTRIBUTES.workflowName]: telemetryContext.run.workflowName,
          [WORKFLOW_ATTRIBUTES.workflowVersion]: telemetryContext.run.workflowVersion,
          [WORKFLOW_ATTRIBUTES.runId]: telemetryContext.run.id,
          [WORKFLOW_ATTRIBUTES.stepId]: telemetryContext.step.id,
          [WORKFLOW_ATTRIBUTES.stepName]: telemetryContext.step.name,
          [WORKFLOW_ATTRIBUTES.stepKind]: telemetryContext.step.kind,
          [WORKFLOW_ATTRIBUTES.stepAttempt]: telemetryContext.attempt,
          [WORKFLOW_ATTRIBUTES.stepTimeoutAt]:
            telemetryContext.timeoutAt === undefined
              ? undefined
              : telemetryContext.timeoutAt.toString(),
        }),
      },
      (span) => withSpanStatus(span, callback),
    );
  }

  async withStorageOperation<T>(
    telemetryContext: StorageTelemetryContext,
    callback: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();

    const attributes = this.#attributes({
      [WORKFLOW_ATTRIBUTES.storageOperation]: telemetryContext.operation,
      [WORKFLOW_ATTRIBUTES.storageBackend]: telemetryContext.backend,
    });

    if (this.#options.includeStorageOperationSpans === false) {
      try {
        const result = await callback();
        this.#recordStorageOperationResult(startedAt, attributes, "success");

        return result;
      } catch (error) {
        this.#recordStorageOperationResult(startedAt, attributes, "failure");
        throw error;
      }
    }

    return await this.#tracer.startActiveSpan(
      WORKFLOW_SPAN_NAMES.storageOperation,
      { attributes },
      async (span) => {
        const record = (status: "success" | "failure") => {
          this.#recordStorageOperationResult(startedAt, attributes, status);
          span.setAttribute(WORKFLOW_ATTRIBUTES.storageOperationStatus, status);
        };

        return await withSpanStatus(span, callback, {
          onSuccess: () => {
            record("success");
            span.setStatus({ code: SpanStatusCode.OK });
          },
          onFailure: () => record("failure"),
        });
      },
    );
  }

  recordRunExecution<TOutput>(telemetryContext: RunTelemetryResultContext<TOutput>): void {
    const result = telemetryContext.result;

    if (result?.kind === "completed" || result?.kind === "failed") {
      const duration = optionalDurationBetweenMilliseconds(
        result.run.startedAt ?? result.run.createdAt,
        result.run.finishedAt,
      );

      if (duration !== undefined) {
        this.#metrics.runDuration.record(
          duration,
          this.#attributes({
            [WORKFLOW_ATTRIBUTES.workflowName]: result.run.workflowName,
            [WORKFLOW_ATTRIBUTES.workflowVersion]: result.run.workflowVersion,
            [WORKFLOW_ATTRIBUTES.runStatus]: result.run.status,
          }),
        );
      }
    }
  }

  observe(...[name, event]: ObservationEventArgs): void {
    switch (name) {
      case "workflow:run-created":
      case "workflow:run-waiting":
      case "workflow:run-rescheduled":
      case "workflow:run-manual-retry":
      case "workflow:run-completed":
      case "workflow:run-canceled": {
        this.#recordRunTransition(event);
        break;
      }

      case "workflow:run-failed": {
        this.#recordRunTransition(event);
        this.#recordRetryExhausted(event);
        break;
      }

      case "workflow:run-permanently-failed": {
        this.#recordRunTransition(event);
        this.#recordRetryExhausted(event);
        break;
      }

      case "workflow:run-claimed": {
        this.#recordRunTransition(event);

        const attributes = this.#runMetricAttributes(event, {
          [WORKFLOW_ATTRIBUTES.workerOperation]: event.reason,
        });

        this.#metrics.workerClaims.add(1, attributes);

        const startedAt =
          event.previousRun?.availableAt ?? event.run.availableAt ?? event.run.createdAt;

        const latency = optionalDurationBetweenMilliseconds(startedAt, event.timestamp);

        if (latency !== undefined) {
          this.#metrics.pendingToClaimedLatency.record(latency, attributes);
        }

        break;
      }

      case "workflow:run-started": {
        this.#recordRunTransition(event);

        if (event.previousRun?.status !== "waiting") {
          break;
        }

        const startedAt = event.previousRun.availableAt ?? event.previousRun.lastTransitionAt;
        const latency = optionalDurationBetweenMilliseconds(startedAt, event.timestamp);

        if (latency !== undefined) {
          this.#metrics.waitingToResumedLatency.record(latency, this.#runMetricAttributes(event));
        }

        break;
      }

      case "workflow:run-lease-released": {
        this.#recordRunTransition(event);
        this.#metrics.workerLeaseReleases.add(1, this.#runMetricAttributes(event));
        break;
      }

      case "workflow:run-retrying": {
        this.#recordRunTransition(event);

        const attributes =
          event.run.retryReason === undefined
            ? this.#runMetricAttributes(event)
            : this.#runMetricAttributes(event, {
                [WORKFLOW_ATTRIBUTES.retryReason]: event.run.retryReason,
              });

        this.#metrics.retryScheduled.add(1, attributes);
        const delay = optionalDurationBetweenMilliseconds(event.timestamp, event.run.retryAt);

        if (delay !== undefined) {
          this.#metrics.retryDelay.record(delay, attributes);
        }

        break;
      }

      case "workflow:durable-event-appended": {
        const descriptor = getEventDescriptor(event.event.kind);
        this.#metrics.eventsAppended.add(
          1,
          this.#attributes({
            [WORKFLOW_ATTRIBUTES.eventKind]: descriptor.kind,
            [WORKFLOW_ATTRIBUTES.eventCategory]: descriptor.category,
          }),
        );
        const history = new History(event.events);
        this.#spans.recordDurableEventLatency(event, history);
        this.#spans.recordDurableSleepSpan(event, history);
        this.#spans.recordChildWorkflowOperationSpan(event, history);
        break;
      }

      case "workflow:step-attempt-updated": {
        const attributes = this.#attributes({
          [WORKFLOW_ATTRIBUTES.stepKind]: event.attempt.kind,
          [WORKFLOW_ATTRIBUTES.stepStatus]: event.attempt.status,
          [WORKFLOW_ATTRIBUTES.stepName]: this.#options.includeStepNameMetricAttribute
            ? event.attempt.stepName
            : undefined,
        });

        this.#metrics.stepAttempts.add(1, attributes);

        if (event.attempt.status === "completed" || event.attempt.status === "failed") {
          const duration = optionalDurationBetweenMilliseconds(
            event.attempt.startedAt,
            event.attempt.finishedAt,
          );

          if (duration !== undefined) {
            this.#metrics.stepDuration.record(duration, attributes);
          }
        }

        break;
      }

      case "workflow:message-sent": {
        this.#metrics.messagesSent.add(1, this.#attributes({}));
        this.#spans.recordMessageSentSpan(event);
        break;
      }

      case "workflow:hook-resumed": {
        this.#metrics.hooksResumed.add(
          1,
          this.#attributes({ [WORKFLOW_ATTRIBUTES.hookKind]: "hook" }),
        );
        this.#spans.recordHookResumeSpan("hook", event);
        break;
      }

      case "workflow:webhook-resumed": {
        this.#metrics.hooksResumed.add(
          1,
          this.#attributes({ [WORKFLOW_ATTRIBUTES.hookKind]: "webhook" }),
        );
        this.#spans.recordHookResumeSpan("webhook", event);
        break;
      }

      case "workflow:stream-updated": {
        this.#metrics.streamUpdates.add(
          1,
          this.#attributes({
            [WORKFLOW_ATTRIBUTES.streamEventKind]: event.eventKind,
            [WORKFLOW_ATTRIBUTES.streamStatus]: streamStatusFromEventKind(event.eventKind),
          }),
        );
        this.#spans.recordStreamOperationSpan(event);
        break;
      }

      case "workflow:child-workflow-started": {
        this.#spans.recordChildWorkflowStartedSpan(event);
        break;
      }

      case "workflow:cleanup-completed": {
        this.#metrics.cleanupDeletedRuns.add(
          event.result.deletedRuns,
          this.#attributes({ [WORKFLOW_ATTRIBUTES.cleanupSource]: "cleanup" }),
        );
        this.#spans.recordCleanupOperationSpan("cleanup", event);
        break;
      }

      case "workflow:retention-applied": {
        this.#metrics.cleanupDeletedRuns.add(
          event.result.deletedRuns,
          this.#attributes({ [WORKFLOW_ATTRIBUTES.cleanupSource]: "retention" }),
        );
        this.#spans.recordCleanupOperationSpan("retention", event);
        break;
      }

      case "workflow:worker-operation": {
        const attributes = this.#attributes({
          [WORKFLOW_ATTRIBUTES.workerOperation]: event.operation,
          [WORKFLOW_ATTRIBUTES.workerOperationStatus]: event.status,
        });

        if (event.operation === "claim" && event.status === "failure") {
          this.#metrics.workerClaimFailures.add(1, attributes);
        }

        if (event.operation === "heartbeat" && event.status === "failure") {
          this.#metrics.workerHeartbeatFailures.add(1, attributes);
        }

        if (event.operation === "lease_extension") {
          this.#metrics.workerLeaseExtensions.add(1, attributes);
        }

        if (event.operation === "lease_release") {
          this.#metrics.workerLeaseReleases.add(1, attributes);
        }

        this.#spans.recordWorkerOperationSpan(event);
        break;
      }

      case "workflow:schedule-ticked": {
        this.#spans.recordScheduleTickSpan(event);
        break;
      }

      case "workflow:schedule-run-created": {
        const attributes = this.#attributes({
          [WORKFLOW_ATTRIBUTES.workflowName]: event.workflowName,
          [WORKFLOW_ATTRIBUTES.workflowVersion]: event.workflowVersion,
        });

        const latency = optionalDurationBetweenMilliseconds(event.fireAt, event.timestamp);

        if (latency !== undefined) {
          this.#metrics.scheduleDueToRunCreatedLatency.record(latency, attributes);
        }

        this.#spans.recordScheduleRunCreatedSpan(event);
        break;
      }
    }
  }

  bindEngine(engine: TelemetryEngine): void {
    this.#engine = engine;
  }

  async shutdown(): Promise<void> {
    const errors: unknown[] = [];

    try {
      await this.#options.forceFlush?.();
    } catch (error) {
      errors.push(error);
    }

    try {
      await this.#options.shutdown?.();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  #recordRunTransition(event: WorkflowLifecycleEvent): void {
    this.#metrics.runTransitions.add(1, this.#runMetricAttributes(event));
  }

  #recordRetryExhausted(event: WorkflowLifecycleEvent): void {
    const retryReason =
      event.previousRun?.retryReason ??
      ((event.previousRun?.attempts ?? event.run.attempts ?? 1) > 1 ? "workflow" : undefined);

    if (retryReason === undefined) {
      return;
    }

    this.#metrics.retryExhausted.add(
      1,
      this.#runMetricAttributes(event, {
        [WORKFLOW_ATTRIBUTES.retryReason]: retryReason,
        [WORKFLOW_ATTRIBUTES.retryExhausted]: true,
      }),
    );
  }

  #attributes(attributes: Attributes): Attributes {
    return omitUndefined({
      "service.namespace": this.#options.serviceNamespace,
      [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
      ...attributes,
    });
  }

  #runExecutionSpanName(telemetryContext: RunTelemetryContext): string {
    return this.#options.includeNamesInSpanNames === true
      ? `${WORKFLOW_SPAN_NAMES.runExecution} ${telemetryContext.run.workflowName}`
      : WORKFLOW_SPAN_NAMES.runExecution;
  }

  #stepExecutionSpanName(telemetryContext: StepTelemetryContext): string {
    return this.#options.includeNamesInSpanNames === true
      ? `${WORKFLOW_SPAN_NAMES.stepExecution} ${telemetryContext.step.name}`
      : WORKFLOW_SPAN_NAMES.stepExecution;
  }

  #recordStorageOperationResult(
    startedAt: number,
    attributes: Attributes,
    status: "failure" | "success",
  ): void {
    const resultAttributes = {
      ...attributes,
      [WORKFLOW_ATTRIBUTES.storageOperationStatus]: status,
    };

    this.#metrics.storageOperationDuration.record(Date.now() - startedAt, resultAttributes);

    if (status === "failure") {
      this.#metrics.storageOperationErrors.add(1, resultAttributes);
    }
  }

  #runMetricAttributes(event: WorkflowLifecycleEvent, attributes: Attributes = {}): Attributes {
    return this.#attributes({
      [WORKFLOW_ATTRIBUTES.workflowName]: event.workflowName,
      [WORKFLOW_ATTRIBUTES.workflowVersion]: event.workflowVersion,
      [WORKFLOW_ATTRIBUTES.runStatus]: event.status,
      [WORKFLOW_ATTRIBUTES.runTransition]: event.reason,
      ...attributes,
    });
  }
}
