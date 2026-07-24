import {
  SpanStatusCode,
  context,
  metrics,
  propagation,
  trace,
  type Attributes,
  type ObservableGauge,
} from "@opentelemetry/api";

import type {
  EventKind,
  MessageWaitCompletedEvent,
  MessageWaitStartedEvent,
} from "./types/events.ts";
import type {
  ChildWorkflowStartedObservationEvent,
  CleanupObservationEvent,
  DurableEventObservationEvent,
  MessageObservationEvent,
  ObservationEventMap,
  ResumeObservationEvent,
  RunObservationEvent,
  ScheduleRunCreatedObservationEvent,
  ScheduleTickObservationEvent,
  StepAttemptObservationEvent,
  StreamObservationEvent,
  WorkerOperationObservationEvent,
} from "./types/observation.ts";
import type {
  RunTelemetryContext,
  RunTelemetryResultContext,
  StepTelemetryContext,
  StorageTelemetryContext,
  Telemetry,
  TelemetryContext,
  TelemetryEngine,
} from "./types/telemetry.ts";

import { getEventDescriptor } from "./events/descriptors.ts";
import { WorkflowHistory } from "./history/mod.ts";
import {
  contextFromTraceContext,
  errorRecordToException,
  spanLinkFromTraceContext,
  streamStatusFromEventKind,
  toException,
  withRunSpanStatus,
  withSpanStatus,
} from "./otel/support.ts";
import {
  WORKFLOW_ATTRIBUTES,
  WORKFLOW_INSTRUMENTATION_NAME,
  WORKFLOW_INSTRUMENTATION_VERSION,
  WORKFLOW_MESSAGING_ATTRIBUTES,
  WORKFLOW_METRIC_NAMES,
  WORKFLOW_SPAN_NAMES,
  WORKFLOW_SYSTEM,
} from "./telemetry.ts";
import { optionalDurationBetweenMilliseconds } from "./temporal.ts";

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
  return new OpenTelemetryWorkflowTelemetry(options);
}

class OpenTelemetryWorkflowTelemetry implements Telemetry {
  readonly #tracer = trace.getTracer(
    WORKFLOW_INSTRUMENTATION_NAME,
    WORKFLOW_INSTRUMENTATION_VERSION,
  );
  readonly #meter = metrics.getMeter(
    WORKFLOW_INSTRUMENTATION_NAME,
    WORKFLOW_INSTRUMENTATION_VERSION,
  );
  readonly #options: OpenTelemetryWorkflowTelemetryOptions;

  readonly #runTransitions = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.runTransitions, {
    description: "Count of workflow run transitions.",
  });
  readonly #runDuration = this.#meter.createHistogram(WORKFLOW_METRIC_NAMES.runDuration, {
    description: "Workflow run duration in milliseconds.",
    unit: "ms",
  });
  readonly #eventsAppended = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.eventsAppended, {
    description: "Count of durable workflow events appended.",
  });
  readonly #stepAttempts = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.stepAttempts, {
    description: "Count of workflow step attempt updates.",
  });
  readonly #stepDuration = this.#meter.createHistogram(WORKFLOW_METRIC_NAMES.stepDuration, {
    description: "Workflow step attempt duration in milliseconds.",
    unit: "ms",
  });
  readonly #messagesSent = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.messagesSent, {
    description: "Count of workflow messages sent.",
  });
  readonly #messageWaitLatency = this.#meter.createHistogram(
    WORKFLOW_METRIC_NAMES.messageWaitLatency,
    {
      description: "Latency from workflow message wait creation to message receipt.",
      unit: "ms",
    },
  );
  readonly #hooksResumed = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.hooksResumed, {
    description: "Count of workflow hooks resumed.",
  });
  readonly #hookResumeLatency = this.#meter.createHistogram(
    WORKFLOW_METRIC_NAMES.hookResumeLatency,
    {
      description: "Latency from workflow hook wait creation to hook resume message receipt.",
      unit: "ms",
    },
  );
  readonly #streamUpdates = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.streamUpdates, {
    description: "Count of workflow stream updates.",
  });
  readonly #cleanupDeletedRuns = this.#meter.createCounter(
    WORKFLOW_METRIC_NAMES.cleanupDeletedRuns,
    {
      description: "Count of workflow runs deleted by cleanup or retention operations.",
    },
  );
  readonly #runGauge: ObservableGauge;
  readonly #workerActiveExecutionsGauge: ObservableGauge;
  readonly #workerClaims = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.workerClaims, {
    description: "Count of workflow run claims by workers.",
  });
  readonly #workerClaimFailures = this.#meter.createCounter(
    WORKFLOW_METRIC_NAMES.workerClaimFailures,
    {
      description: "Count of failed targeted workflow run claims by workers.",
    },
  );
  readonly #workerHeartbeatFailures = this.#meter.createCounter(
    WORKFLOW_METRIC_NAMES.workerHeartbeatFailures,
    {
      description: "Count of failed workflow worker heartbeat lease extensions.",
    },
  );
  readonly #workerLeaseExtensions = this.#meter.createCounter(
    WORKFLOW_METRIC_NAMES.workerLeaseExtensions,
    {
      description: "Count of workflow run lease extension attempts.",
    },
  );
  readonly #workerLeaseReleases = this.#meter.createCounter(
    WORKFLOW_METRIC_NAMES.workerLeaseReleases,
    {
      description: "Count of workflow run lease releases.",
    },
  );
  readonly #pendingToClaimedLatency = this.#meter.createHistogram(
    WORKFLOW_METRIC_NAMES.pendingToClaimedLatency,
    {
      description: "Latency from workflow availability to worker claim in milliseconds.",
      unit: "ms",
    },
  );
  readonly #waitingToResumedLatency = this.#meter.createHistogram(
    WORKFLOW_METRIC_NAMES.runWaitingToResumedLatency,
    {
      description: "Latency from workflow waiting state to resumed execution in milliseconds.",
      unit: "ms",
    },
  );
  readonly #retryScheduled = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.retryScheduled, {
    description: "Count of workflow retries scheduled.",
  });
  readonly #retryExhausted = this.#meter.createCounter(WORKFLOW_METRIC_NAMES.retryExhausted, {
    description: "Count of workflow retries exhausted into permanent failure.",
  });
  readonly #retryDelay = this.#meter.createHistogram(WORKFLOW_METRIC_NAMES.retryDelay, {
    description: "Delay until a scheduled workflow retry in milliseconds.",
    unit: "ms",
  });
  readonly #scheduleDueToRunCreatedLatency = this.#meter.createHistogram(
    WORKFLOW_METRIC_NAMES.scheduleDueToRunCreatedLatency,
    {
      description: "Latency from recurring schedule fire time to scheduled run creation.",
      unit: "ms",
    },
  );
  readonly #storageOperationDuration = this.#meter.createHistogram(
    WORKFLOW_METRIC_NAMES.storageOperationDuration,
    {
      description: "Workflow storage/backend operation duration in milliseconds.",
      unit: "ms",
    },
  );
  readonly #storageOperationErrors = this.#meter.createCounter(
    WORKFLOW_METRIC_NAMES.storageOperationErrors,
    {
      description: "Count of workflow storage/backend operation failures.",
    },
  );

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
      : {
          ...(carrier.traceparent === undefined ? {} : { traceparent: carrier.traceparent }),
          ...(carrier.tracestate === undefined ? {} : { tracestate: carrier.tracestate }),
        };
  }

  async withRunExecution<T>(
    telemetryContext: RunTelemetryContext,
    callback: () => Promise<T>,
  ): Promise<T> {
    const parent = contextFromTraceContext(telemetryContext.traceContext);
    return await this.#tracer.startActiveSpan(
      this.#runExecutionSpanName(telemetryContext),
      {
        attributes: this.#attributes({
          [WORKFLOW_ATTRIBUTES.workflowName]: telemetryContext.run.workflowName,
          ...(telemetryContext.run.workflowVersion === undefined
            ? {}
            : { [WORKFLOW_ATTRIBUTES.workflowVersion]: telemetryContext.run.workflowVersion }),
          [WORKFLOW_ATTRIBUTES.runId]: telemetryContext.run.id,
          [WORKFLOW_ATTRIBUTES.namespace]: telemetryContext.run.namespace,
          ...(telemetryContext.run.attempts === undefined
            ? {}
            : { [WORKFLOW_ATTRIBUTES.runAttempt]: telemetryContext.run.attempts }),
          ...(telemetryContext.run.workerId === undefined
            ? {}
            : { [WORKFLOW_ATTRIBUTES.workerId]: telemetryContext.run.workerId }),
        }),
      },
      parent,
      async (span) => await withRunSpanStatus(span, callback),
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
          ...(telemetryContext.run.workflowVersion === undefined
            ? {}
            : { [WORKFLOW_ATTRIBUTES.workflowVersion]: telemetryContext.run.workflowVersion }),
          [WORKFLOW_ATTRIBUTES.runId]: telemetryContext.run.id,
          [WORKFLOW_ATTRIBUTES.stepId]: telemetryContext.step.id,
          [WORKFLOW_ATTRIBUTES.stepName]: telemetryContext.step.name,
          [WORKFLOW_ATTRIBUTES.stepKind]: telemetryContext.step.kind,
          [WORKFLOW_ATTRIBUTES.stepAttempt]: telemetryContext.attempt,
          ...(telemetryContext.timeoutAt === undefined
            ? {}
            : { [WORKFLOW_ATTRIBUTES.stepTimeoutAt]: telemetryContext.timeoutAt.toString() }),
        }),
      },
      async (span) => await withSpanStatus(span, callback),
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
        try {
          const result = await callback();
          this.#recordStorageOperationResult(startedAt, attributes, "success");
          span.setAttribute(WORKFLOW_ATTRIBUTES.storageOperationStatus, "success");
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          this.#recordStorageOperationResult(startedAt, attributes, "failure");
          span.setAttribute(WORKFLOW_ATTRIBUTES.storageOperationStatus, "failure");
          span.recordException(toException(error));
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
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
        this.#runDuration.record(
          duration,
          this.#attributes({
            [WORKFLOW_ATTRIBUTES.workflowName]: result.run.workflowName,
            ...(result.run.workflowVersion === undefined
              ? {}
              : { [WORKFLOW_ATTRIBUTES.workflowVersion]: result.run.workflowVersion }),
            [WORKFLOW_ATTRIBUTES.runStatus]: result.run.status,
          }),
        );
      }
    }
  }

  observe<Key extends keyof ObservationEventMap>(
    name: Key,
    payload: ObservationEventMap[Key],
  ): void {
    switch (name) {
      case "workflow:run-created":
      case "workflow:run-waiting":
      case "workflow:run-rescheduled":
      case "workflow:run-manual-retry":
      case "workflow:run-completed":
      case "workflow:run-canceled": {
        const event = payload as RunObservationEvent;
        this.#recordRunTransition(event);
        break;
      }
      case "workflow:run-failed": {
        const event = payload as RunObservationEvent;
        this.#recordRunTransition(event);
        this.#recordRetryExhausted(event);
        break;
      }
      case "workflow:run-permanently-failed": {
        const event = payload as RunObservationEvent;
        this.#recordRunTransition(event);
        this.#recordRetryExhausted(event);
        break;
      }
      case "workflow:run-claimed": {
        const event = payload as RunObservationEvent;
        this.#recordRunTransition(event);
        const attributes = this.#runMetricAttributes(event, {
          [WORKFLOW_ATTRIBUTES.workerOperation]: event.reason,
        });
        this.#workerClaims.add(1, attributes);
        const startedAt =
          event.previousRun?.availableAt ?? event.run.availableAt ?? event.run.createdAt;
        const latency = optionalDurationBetweenMilliseconds(startedAt, event.timestamp);
        if (latency !== undefined) {
          this.#pendingToClaimedLatency.record(latency, attributes);
        }
        break;
      }
      case "workflow:run-started": {
        const event = payload as RunObservationEvent;
        this.#recordRunTransition(event);
        if (event.previousRun?.status !== "waiting") {
          break;
        }
        const startedAt = event.previousRun.availableAt ?? event.previousRun.lastTransitionAt;
        const latency = optionalDurationBetweenMilliseconds(startedAt, event.timestamp);
        if (latency !== undefined) {
          this.#waitingToResumedLatency.record(latency, this.#runMetricAttributes(event));
        }
        break;
      }
      case "workflow:run-lease-released": {
        const event = payload as RunObservationEvent;
        this.#recordRunTransition(event);
        this.#workerLeaseReleases.add(1, this.#runMetricAttributes(event));
        break;
      }
      case "workflow:run-retrying": {
        const event = payload as RunObservationEvent;
        this.#recordRunTransition(event);
        const attributes =
          event.run.retryReason === undefined
            ? this.#runMetricAttributes(event)
            : this.#runMetricAttributes(event, {
                [WORKFLOW_ATTRIBUTES.retryReason]: event.run.retryReason,
              });
        this.#retryScheduled.add(1, attributes);
        const delay = optionalDurationBetweenMilliseconds(event.timestamp, event.run.retryAt);
        if (delay !== undefined) {
          this.#retryDelay.record(delay, attributes);
        }
        break;
      }
      case "workflow:durable-event-appended": {
        const event = payload as DurableEventObservationEvent;
        const descriptor = getEventDescriptor(event.event.kind as EventKind);
        this.#eventsAppended.add(
          1,
          this.#attributes({
            [WORKFLOW_ATTRIBUTES.eventKind]: descriptor.kind,
            [WORKFLOW_ATTRIBUTES.eventCategory]: descriptor.category,
          }),
        );
        const history = new WorkflowHistory(event.events);
        this.#recordDurableEventLatency(event, history);
        this.#recordDurableSleepSpan(event, history);
        this.#recordChildWorkflowOperationSpan(event, history);
        break;
      }
      case "workflow:step-attempt-updated": {
        const event = payload as StepAttemptObservationEvent;
        const attributes = this.#attributes({
          [WORKFLOW_ATTRIBUTES.stepKind]: event.attempt.kind,
          [WORKFLOW_ATTRIBUTES.stepStatus]: event.attempt.status,
          ...(this.#options.includeStepNameMetricAttribute
            ? { [WORKFLOW_ATTRIBUTES.stepName]: event.attempt.stepName }
            : {}),
        });
        this.#stepAttempts.add(1, attributes);
        if (event.attempt.status === "completed" || event.attempt.status === "failed") {
          const duration = optionalDurationBetweenMilliseconds(
            event.attempt.startedAt,
            event.attempt.finishedAt,
          );
          if (duration !== undefined) {
            this.#stepDuration.record(duration, attributes);
          }
        }
        break;
      }
      case "workflow:message-sent": {
        const event = payload as MessageObservationEvent;
        this.#messagesSent.add(1, this.#attributes({}));
        this.#recordMessageSentSpan(event);
        break;
      }
      case "workflow:hook-resumed": {
        const event = payload as ResumeObservationEvent;
        this.#hooksResumed.add(1, this.#attributes({ [WORKFLOW_ATTRIBUTES.hookKind]: "hook" }));
        this.#recordHookResumeSpan("hook", event);
        break;
      }
      case "workflow:webhook-resumed": {
        const event = payload as ResumeObservationEvent;
        this.#hooksResumed.add(1, this.#attributes({ [WORKFLOW_ATTRIBUTES.hookKind]: "webhook" }));
        this.#recordHookResumeSpan("webhook", event);
        break;
      }
      case "workflow:stream-updated": {
        const event = payload as StreamObservationEvent;
        this.#streamUpdates.add(
          1,
          this.#attributes({
            [WORKFLOW_ATTRIBUTES.streamEventKind]: event.eventKind,
            [WORKFLOW_ATTRIBUTES.streamStatus]: streamStatusFromEventKind(event.eventKind),
          }),
        );
        this.#recordStreamOperationSpan(event);
        break;
      }
      case "workflow:child-workflow-started": {
        const event = payload as ChildWorkflowStartedObservationEvent;
        this.#recordChildWorkflowStartedSpan(event);
        break;
      }
      case "workflow:cleanup-completed": {
        const event = payload as CleanupObservationEvent;
        this.#cleanupDeletedRuns.add(
          event.result.deletedRuns,
          this.#attributes({ [WORKFLOW_ATTRIBUTES.cleanupSource]: "cleanup" }),
        );
        this.#recordCleanupOperationSpan("cleanup", event);
        break;
      }
      case "workflow:retention-applied": {
        const event = payload as CleanupObservationEvent;
        this.#cleanupDeletedRuns.add(
          event.result.deletedRuns,
          this.#attributes({ [WORKFLOW_ATTRIBUTES.cleanupSource]: "retention" }),
        );
        this.#recordCleanupOperationSpan("retention", event);
        break;
      }
      case "workflow:worker-operation": {
        const event = payload as WorkerOperationObservationEvent;
        const attributes = this.#attributes({
          [WORKFLOW_ATTRIBUTES.workerOperation]: event.operation,
          [WORKFLOW_ATTRIBUTES.workerOperationStatus]: event.status,
        });
        if (event.operation === "claim" && event.status === "failure") {
          this.#workerClaimFailures.add(1, attributes);
        }
        if (event.operation === "heartbeat" && event.status === "failure") {
          this.#workerHeartbeatFailures.add(1, attributes);
        }
        if (event.operation === "lease_extension") {
          this.#workerLeaseExtensions.add(1, attributes);
        }
        if (event.operation === "lease_release") {
          this.#workerLeaseReleases.add(1, attributes);
        }
        this.#recordWorkerOperationSpan(event);
        break;
      }
      case "workflow:schedule-ticked": {
        const event = payload as ScheduleTickObservationEvent;
        this.#recordScheduleTickSpan(event);
        break;
      }
      case "workflow:schedule-run-created": {
        const event = payload as ScheduleRunCreatedObservationEvent;
        const attributes = this.#attributes({
          [WORKFLOW_ATTRIBUTES.workflowName]: event.workflowName,
          ...(event.workflowVersion === undefined
            ? {}
            : { [WORKFLOW_ATTRIBUTES.workflowVersion]: event.workflowVersion }),
        });
        const latency = optionalDurationBetweenMilliseconds(event.fireAt, event.timestamp);
        if (latency !== undefined) {
          this.#scheduleDueToRunCreatedLatency.record(latency, attributes);
        }
        this.#recordScheduleRunCreatedSpan(event);
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

  #recordRunTransition(event: RunObservationEvent): void {
    this.#runTransitions.add(1, this.#runMetricAttributes(event));
  }

  #recordRetryExhausted(event: RunObservationEvent): void {
    const retryReason =
      event.previousRun?.retryReason ??
      ((event.previousRun?.attempts ?? event.run.attempts ?? 1) > 1 ? "workflow" : undefined);
    if (retryReason === undefined) {
      return;
    }
    this.#retryExhausted.add(
      1,
      this.#runMetricAttributes(event, {
        [WORKFLOW_ATTRIBUTES.retryReason]: retryReason,
        [WORKFLOW_ATTRIBUTES.retryExhausted]: true,
      }),
    );
  }

  #attributes(attributes: Attributes): Attributes {
    return {
      ...(this.#options.serviceNamespace === undefined
        ? {}
        : { "service.namespace": this.#options.serviceNamespace }),
      [WORKFLOW_ATTRIBUTES.system]: WORKFLOW_SYSTEM,
      ...attributes,
    };
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
    this.#storageOperationDuration.record(Date.now() - startedAt, resultAttributes);
    if (status === "failure") {
      this.#storageOperationErrors.add(1, resultAttributes);
    }
  }

  #runMetricAttributes(event: RunObservationEvent, attributes: Attributes = {}): Attributes {
    return this.#attributes({
      [WORKFLOW_ATTRIBUTES.workflowName]: event.workflowName,
      ...(event.workflowVersion === undefined
        ? {}
        : { [WORKFLOW_ATTRIBUTES.workflowVersion]: event.workflowVersion }),
      [WORKFLOW_ATTRIBUTES.runStatus]: event.status,
      [WORKFLOW_ATTRIBUTES.runTransition]: event.reason,
      ...attributes,
    });
  }

  #recordDurableEventLatency(event: DurableEventObservationEvent, history: WorkflowHistory): void {
    if (event.event.kind !== "message_wait_completed") {
      return;
    }
    const completed = event.event;
    const started = history.startedMessageWaitForCompleted(completed);
    if (started === undefined) {
      return;
    }
    const latency = optionalDurationBetweenMilliseconds(
      started.timestamp,
      completed.messageTimestamp,
    );
    if (latency === undefined) {
      return;
    }
    const source = started.source ?? "message";
    const attributes = this.#attributes({ [WORKFLOW_ATTRIBUTES.messageSource]: source });
    this.#messageWaitLatency.record(latency, attributes);
    if (source === "hook" || source === "webhook") {
      this.#hookResumeLatency.record(
        latency,
        this.#attributes({ [WORKFLOW_ATTRIBUTES.hookKind]: source }),
      );
    }
    this.#recordMessageWaitSpan(completed, started, history);
  }

  #recordDurableSleepSpan(event: DurableEventObservationEvent, history: WorkflowHistory): void {
    if (event.event.kind !== "sleep_completed") {
      return;
    }
    const completed = event.event;
    const started = history.startedSleepForCompleted(completed);
    if (started === undefined) {
      return;
    }
    const requestedDuration =
      started.duration === undefined ? undefined : started.duration.total({ unit: "millisecond" });
    const actualDuration = optionalDurationBetweenMilliseconds(
      started.timestamp,
      completed.timestamp,
    );
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.sleep, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.runId]: event.runId,
        [WORKFLOW_ATTRIBUTES.stepId]: completed.stepId,
        [WORKFLOW_ATTRIBUTES.stepName]: completed.stepName,
        [WORKFLOW_ATTRIBUTES.stepKind]: "sleep",
        [WORKFLOW_ATTRIBUTES.sleepUntil]: started.until.toString(),
        ...(requestedDuration === undefined
          ? {}
          : { [WORKFLOW_ATTRIBUTES.sleepDurationMs]: requestedDuration }),
        ...(actualDuration === undefined
          ? {}
          : { [WORKFLOW_ATTRIBUTES.sleepActualMs]: actualDuration }),
      }),
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  #recordChildWorkflowOperationSpan(
    event: DurableEventObservationEvent,
    history: WorkflowHistory,
  ): void {
    if (
      event.event.kind !== "child_workflow_completed" &&
      event.event.kind !== "child_workflow_failed"
    ) {
      return;
    }
    const terminal = event.event;
    const started = history.startedChildWorkflowForTerminal(terminal);
    const duration =
      started === undefined
        ? undefined
        : optionalDurationBetweenMilliseconds(started.timestamp, terminal.timestamp);
    const failed = terminal.kind === "child_workflow_failed";
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.childWorkflowOperation, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.runId]: event.runId,
        [WORKFLOW_ATTRIBUTES.stepId]: terminal.stepId,
        [WORKFLOW_ATTRIBUTES.stepName]: terminal.stepName,
        [WORKFLOW_ATTRIBUTES.stepKind]: "workflow",
        [WORKFLOW_ATTRIBUTES.stepAttempt]: terminal.attempt,
        [WORKFLOW_ATTRIBUTES.childWorkflowOperation]: failed ? "fail" : "complete",
        [WORKFLOW_ATTRIBUTES.childWorkflowRunId]: terminal.childRunId,
        ...(started === undefined
          ? {}
          : {
              [WORKFLOW_ATTRIBUTES.childWorkflowName]: started.workflowName,
              ...(started.workflowVersion === undefined
                ? {}
                : { [WORKFLOW_ATTRIBUTES.childWorkflowVersion]: started.workflowVersion }),
            }),
        [WORKFLOW_ATTRIBUTES.childWorkflowStatus]: failed ? "failed" : "completed",
        ...(duration === undefined
          ? {}
          : { [WORKFLOW_ATTRIBUTES.childWorkflowDurationMs]: duration }),
        ...(failed ? { [WORKFLOW_ATTRIBUTES.errorKind]: terminal.error.name } : {}),
      }),
    });
    if (failed) {
      span.recordException(errorRecordToException(terminal.error));
      span.setStatus({ code: SpanStatusCode.ERROR, message: terminal.error.message });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  #recordChildWorkflowStartedSpan(event: ChildWorkflowStartedObservationEvent): void {
    const started = event.event;
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.childWorkflowOperation, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.runId]: event.runId,
        [WORKFLOW_ATTRIBUTES.stepId]: started.stepId,
        [WORKFLOW_ATTRIBUTES.stepName]: started.stepName,
        [WORKFLOW_ATTRIBUTES.stepKind]: "workflow",
        [WORKFLOW_ATTRIBUTES.stepAttempt]: started.attempt,
        [WORKFLOW_ATTRIBUTES.childWorkflowOperation]: "start",
        [WORKFLOW_ATTRIBUTES.childWorkflowRunId]: started.childRunId,
        [WORKFLOW_ATTRIBUTES.childWorkflowName]: started.workflowName,
        ...(started.workflowVersion === undefined
          ? {}
          : { [WORKFLOW_ATTRIBUTES.childWorkflowVersion]: started.workflowVersion }),
        [WORKFLOW_ATTRIBUTES.childWorkflowStatus]: "started",
      }),
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  #recordMessageSentSpan(event: MessageObservationEvent): void {
    const parent = contextFromTraceContext(event.traceContext);
    const span = this.#tracer.startSpan(
      WORKFLOW_SPAN_NAMES.messageSend,
      {
        attributes: this.#attributes({
          [WORKFLOW_ATTRIBUTES.runId]: event.runId,
          [WORKFLOW_ATTRIBUTES.messageId]: event.messageId,
          [WORKFLOW_MESSAGING_ATTRIBUTES.system]: "temelj.workflow",
          [WORKFLOW_MESSAGING_ATTRIBUTES.destinationName]: event.runId,
          [WORKFLOW_MESSAGING_ATTRIBUTES.messageId]: event.messageId,
          [WORKFLOW_MESSAGING_ATTRIBUTES.operationName]: "send",
          [WORKFLOW_MESSAGING_ATTRIBUTES.operationType]: "publish",
        }),
      },
      parent,
    );
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  #recordHookResumeSpan(kind: "hook" | "webhook", event: ResumeObservationEvent): void {
    const parent = contextFromTraceContext(event.traceContext);
    const span = this.#tracer.startSpan(
      WORKFLOW_SPAN_NAMES.hookResume,
      {
        attributes: this.#attributes({
          [WORKFLOW_ATTRIBUTES.hookKind]: kind,
          [WORKFLOW_ATTRIBUTES.runId]: event.runId,
          [WORKFLOW_ATTRIBUTES.messageId]: event.messageId,
          [WORKFLOW_MESSAGING_ATTRIBUTES.system]: "temelj.workflow",
          [WORKFLOW_MESSAGING_ATTRIBUTES.destinationName]: event.runId,
          [WORKFLOW_MESSAGING_ATTRIBUTES.messageId]: event.messageId,
          [WORKFLOW_MESSAGING_ATTRIBUTES.operationName]: "resume",
          [WORKFLOW_MESSAGING_ATTRIBUTES.operationType]: "publish",
        }),
      },
      parent,
    );
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  #recordScheduleRunCreatedSpan(event: ScheduleRunCreatedObservationEvent): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.scheduleRunCreate, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.workflowName]: event.workflowName,
        ...(event.workflowVersion === undefined
          ? {}
          : { [WORKFLOW_ATTRIBUTES.workflowVersion]: event.workflowVersion }),
        [WORKFLOW_ATTRIBUTES.scheduleId]: event.scheduleId,
        [WORKFLOW_ATTRIBUTES.scheduleFireAt]: event.fireAt.toString(),
        [WORKFLOW_ATTRIBUTES.runId]: event.runId,
      }),
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  #recordScheduleTickSpan(event: ScheduleTickObservationEvent): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.scheduleTick, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.scheduleTickedRuns]: event.result.ticked,
        [WORKFLOW_ATTRIBUTES.scheduleTickedSchedules]: event.result.scheduleIds.length,
        ...(event.result.nextScheduleAt === undefined
          ? {}
          : { [WORKFLOW_ATTRIBUTES.scheduleNextAt]: event.result.nextScheduleAt.toString() }),
      }),
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  #recordWorkerOperationSpan(event: WorkerOperationObservationEvent): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.workerOperation, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.workerId]: event.workerId,
        ...(event.runId === undefined ? {} : { [WORKFLOW_ATTRIBUTES.runId]: event.runId }),
        ...(event.run === undefined
          ? {}
          : {
              [WORKFLOW_ATTRIBUTES.workflowName]: event.run.workflowName,
              ...(event.run.workflowVersion === undefined
                ? {}
                : { [WORKFLOW_ATTRIBUTES.workflowVersion]: event.run.workflowVersion }),
              [WORKFLOW_ATTRIBUTES.runStatus]: event.run.status,
            }),
        [WORKFLOW_ATTRIBUTES.workerOperation]: event.operation,
        [WORKFLOW_ATTRIBUTES.workerOperationStatus]: event.status,
      }),
    });
    if (event.status === "failure") {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (event.error !== undefined) {
        span.recordException(toException(event.error));
      }
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  #recordCleanupOperationSpan(
    source: "cleanup" | "retention",
    event: CleanupObservationEvent,
  ): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.cleanupOperation, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.cleanupSource]: source,
        [WORKFLOW_ATTRIBUTES.cleanupDeletedRuns]: event.result.deletedRuns,
        [WORKFLOW_ATTRIBUTES.cleanupCreatedMarkers]: event.result.createdCleanupMarkers,
        [WORKFLOW_ATTRIBUTES.cleanupDeletedMarkers]: event.result.deletedCleanupMarkers,
        [WORKFLOW_ATTRIBUTES.cleanupDeletedEvents]: event.result.deletedEvents,
        [WORKFLOW_ATTRIBUTES.cleanupDeletedStepAttempts]: event.result.deletedStepAttempts,
        [WORKFLOW_ATTRIBUTES.cleanupDeletedIdempotencyKeys]: event.result.deletedIdempotencyKeys,
        [WORKFLOW_ATTRIBUTES.cleanupDeletedMessageIdempotencyKeys]:
          event.result.deletedMessageIdempotencyKeys,
        ...(event.result.dryRun === undefined
          ? {}
          : { [WORKFLOW_ATTRIBUTES.cleanupDryRun]: event.result.dryRun }),
        [WORKFLOW_ATTRIBUTES.cleanupMatchedRuns]:
          event.result.matchedRuns ?? event.result.runIds.length,
      }),
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  #recordStreamOperationSpan(event: StreamObservationEvent): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.streamOperation, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.runId]: event.runId,
        [WORKFLOW_ATTRIBUTES.streamId]: event.streamId,
        [WORKFLOW_ATTRIBUTES.streamEventKind]: event.eventKind,
        [WORKFLOW_ATTRIBUTES.streamStatus]: streamStatusFromEventKind(event.eventKind),
        [WORKFLOW_ATTRIBUTES.stepId]: event.stepId,
        [WORKFLOW_ATTRIBUTES.stepName]: event.stepName,
        ...(event.index === undefined ? {} : { [WORKFLOW_ATTRIBUTES.streamIndex]: event.index }),
        ...(event.error === undefined ? {} : { [WORKFLOW_ATTRIBUTES.errorKind]: event.error.name }),
      }),
    });
    if (event.error === undefined) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.recordException(errorRecordToException(event.error));
      span.setStatus({ code: SpanStatusCode.ERROR, message: event.error.message });
    }
    span.end();
  }

  #recordMessageWaitSpan(
    completed: MessageWaitCompletedEvent,
    started: MessageWaitStartedEvent,
    history: WorkflowHistory,
  ): void {
    const message = history.messageSentByTimestamp(completed.messageId, completed.messageTimestamp);
    const link = spanLinkFromTraceContext(completed.telemetryContext ?? message?.telemetryContext);
    return this.#tracer.startActiveSpan(
      WORKFLOW_SPAN_NAMES.messageWait,
      {
        attributes: this.#attributes({
          [WORKFLOW_ATTRIBUTES.messageId]: completed.messageId,
          [WORKFLOW_ATTRIBUTES.messageSource]: started.source ?? "message",
          [WORKFLOW_ATTRIBUTES.stepId]: completed.stepId,
          [WORKFLOW_ATTRIBUTES.stepName]: completed.stepName,
          [WORKFLOW_MESSAGING_ATTRIBUTES.system]: "temelj.workflow",
          [WORKFLOW_MESSAGING_ATTRIBUTES.messageId]: completed.messageId,
          [WORKFLOW_MESSAGING_ATTRIBUTES.operationName]: "receive",
          [WORKFLOW_MESSAGING_ATTRIBUTES.operationType]: "receive",
        }),
        ...(link === undefined ? {} : { links: [link] }),
      },
      (span) => {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      },
    );
  }
}
