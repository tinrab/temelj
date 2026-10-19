import type { Tracer } from "@opentelemetry/api";

import { SpanStatusCode, type Attributes } from "@opentelemetry/api";

import type { MessageWaitCompletedEvent, MessageWaitStartedEvent } from "../types/events.ts";
import type {
  ChildWorkflowStartedObservationEvent,
  CleanupObservationEvent,
  DurableEventObservationEvent,
  MessageObservationEvent,
  ResumeObservationEvent,
  ScheduleRunCreatedObservationEvent,
  ScheduleTickObservationEvent,
  StreamObservationEvent,
  WorkerOperationObservationEvent,
} from "../types/observation.ts";
import type { Instruments } from "./metrics.ts";

import { History } from "../history/replay.ts";
import {
  WORKFLOW_ATTRIBUTES,
  WORKFLOW_MESSAGING_ATTRIBUTES,
  WORKFLOW_SPAN_NAMES,
} from "../telemetry.ts";
import { optionalDurationBetweenMilliseconds } from "../temporal.ts";
import {
  contextFromTraceContext,
  errorRecordToException,
  spanLinkFromTraceContext,
  streamStatusFromEventKind,
  toException,
} from "./support.ts";

/** Records the spans for durable events, messages, hooks, schedules, workers, and streams. */
export class SpanRecorder {
  readonly #tracer: Tracer;
  readonly #metrics: Instruments;
  readonly #attributes: (attributes: Attributes) => Attributes;

  constructor(
    tracer: Tracer,
    metrics: Instruments,
    attributes: (attributes: Attributes) => Attributes,
  ) {
    this.#tracer = tracer;
    this.#metrics = metrics;
    this.#attributes = attributes;
  }

  recordDurableEventLatency(event: DurableEventObservationEvent, history: History): void {
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
    this.#metrics.messageWaitLatency.record(latency, attributes);

    if (source === "hook" || source === "webhook") {
      this.#metrics.hookResumeLatency.record(
        latency,
        this.#attributes({ [WORKFLOW_ATTRIBUTES.hookKind]: source }),
      );
    }

    this.recordMessageWaitSpan(completed, started, history);
  }

  recordDurableSleepSpan(event: DurableEventObservationEvent, history: History): void {
    if (event.event.kind !== "sleep_completed") {
      return;
    }

    const completed = event.event;
    const started = history.startedSleepForCompleted(completed);

    if (started === undefined) {
      return;
    }

    const requestedDuration = started.duration?.total({ unit: "millisecond" });

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
        [WORKFLOW_ATTRIBUTES.sleepDurationMs]: requestedDuration,
        [WORKFLOW_ATTRIBUTES.sleepActualMs]: actualDuration,
      }),
    });

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  recordChildWorkflowOperationSpan(event: DurableEventObservationEvent, history: History): void {
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
        [WORKFLOW_ATTRIBUTES.childWorkflowName]: started?.workflowName,
        [WORKFLOW_ATTRIBUTES.childWorkflowVersion]: started?.workflowVersion,
        [WORKFLOW_ATTRIBUTES.childWorkflowStatus]: failed ? "failed" : "completed",
        [WORKFLOW_ATTRIBUTES.childWorkflowDurationMs]: duration,
        [WORKFLOW_ATTRIBUTES.errorKind]: failed ? terminal.error.name : undefined,
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

  recordChildWorkflowStartedSpan(event: ChildWorkflowStartedObservationEvent): void {
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
        [WORKFLOW_ATTRIBUTES.childWorkflowVersion]: started.workflowVersion,
        [WORKFLOW_ATTRIBUTES.childWorkflowStatus]: "started",
      }),
    });

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  recordMessageSentSpan(event: MessageObservationEvent): void {
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

  recordHookResumeSpan(kind: "hook" | "webhook", event: ResumeObservationEvent): void {
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

  recordScheduleRunCreatedSpan(event: ScheduleRunCreatedObservationEvent): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.scheduleRunCreate, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.workflowName]: event.workflowName,
        [WORKFLOW_ATTRIBUTES.workflowVersion]: event.workflowVersion,
        [WORKFLOW_ATTRIBUTES.scheduleId]: event.scheduleId,
        [WORKFLOW_ATTRIBUTES.scheduleFireAt]: event.fireAt.toString(),
        [WORKFLOW_ATTRIBUTES.runId]: event.runId,
      }),
    });

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  recordScheduleTickSpan(event: ScheduleTickObservationEvent): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.scheduleTick, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.scheduleTickedRuns]: event.result.ticked,
        [WORKFLOW_ATTRIBUTES.scheduleTickedSchedules]: event.result.scheduleIds.length,
        [WORKFLOW_ATTRIBUTES.scheduleNextAt]:
          event.result.nextScheduleAt === undefined
            ? undefined
            : event.result.nextScheduleAt.toString(),
      }),
    });

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  recordWorkerOperationSpan(event: WorkerOperationObservationEvent): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.workerOperation, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.workerId]: event.workerId,
        [WORKFLOW_ATTRIBUTES.runId]: event.runId,
        [WORKFLOW_ATTRIBUTES.workflowName]: event.run?.workflowName,
        [WORKFLOW_ATTRIBUTES.workflowVersion]: event.run?.workflowVersion,
        [WORKFLOW_ATTRIBUTES.runStatus]: event.run?.status,
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

  recordCleanupOperationSpan(
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
        [WORKFLOW_ATTRIBUTES.cleanupDryRun]: event.result.dryRun,
        [WORKFLOW_ATTRIBUTES.cleanupMatchedRuns]:
          event.result.matchedRuns ?? event.result.runIds.length,
      }),
    });

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  recordStreamOperationSpan(event: StreamObservationEvent): void {
    const span = this.#tracer.startSpan(WORKFLOW_SPAN_NAMES.streamOperation, {
      attributes: this.#attributes({
        [WORKFLOW_ATTRIBUTES.runId]: event.runId,
        [WORKFLOW_ATTRIBUTES.streamId]: event.streamId,
        [WORKFLOW_ATTRIBUTES.streamEventKind]: event.eventKind,
        [WORKFLOW_ATTRIBUTES.streamStatus]: streamStatusFromEventKind(event.eventKind),
        [WORKFLOW_ATTRIBUTES.stepId]: event.stepId,
        [WORKFLOW_ATTRIBUTES.stepName]: event.stepName,
        [WORKFLOW_ATTRIBUTES.streamIndex]: event.index,
        [WORKFLOW_ATTRIBUTES.errorKind]: event.error?.name,
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

  recordMessageWaitSpan(
    completed: MessageWaitCompletedEvent,
    started: MessageWaitStartedEvent,
    history: History,
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
        links: link === undefined ? [] : [link],
      },
      (span) => {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      },
    );
  }
}
