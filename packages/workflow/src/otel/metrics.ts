import type { Counter, Histogram, Meter } from "@opentelemetry/api";

import { WORKFLOW_METRIC_NAMES } from "../telemetry.ts";

export interface Instruments {
  readonly runTransitions: Counter;
  readonly runDuration: Histogram;
  readonly eventsAppended: Counter;
  readonly stepAttempts: Counter;
  readonly stepDuration: Histogram;
  readonly messagesSent: Counter;
  readonly messageWaitLatency: Histogram;
  readonly hooksResumed: Counter;
  readonly hookResumeLatency: Histogram;
  readonly streamUpdates: Counter;
  readonly cleanupDeletedRuns: Counter;
  readonly workerClaims: Counter;
  readonly workerClaimFailures: Counter;
  readonly workerHeartbeatFailures: Counter;
  readonly workerLeaseExtensions: Counter;
  readonly workerLeaseReleases: Counter;
  readonly pendingToClaimedLatency: Histogram;
  readonly waitingToResumedLatency: Histogram;
  readonly retryScheduled: Counter;
  readonly retryExhausted: Counter;
  readonly retryDelay: Histogram;
  readonly scheduleDueToRunCreatedLatency: Histogram;
  readonly storageOperationDuration: Histogram;
  readonly storageOperationErrors: Counter;
}

/** The counters and histograms the OpenTelemetry adapter records. */
export function createInstruments(meter: Meter): Instruments {
  return {
    runTransitions: meter.createCounter(WORKFLOW_METRIC_NAMES.runTransitions, {
      description: "Count of workflow run transitions.",
    }),
    runDuration: meter.createHistogram(WORKFLOW_METRIC_NAMES.runDuration, {
      description: "Workflow run duration in milliseconds.",
      unit: "ms",
    }),
    eventsAppended: meter.createCounter(WORKFLOW_METRIC_NAMES.eventsAppended, {
      description: "Count of durable workflow events appended.",
    }),
    stepAttempts: meter.createCounter(WORKFLOW_METRIC_NAMES.stepAttempts, {
      description: "Count of workflow step attempt updates.",
    }),
    stepDuration: meter.createHistogram(WORKFLOW_METRIC_NAMES.stepDuration, {
      description: "Workflow step attempt duration in milliseconds.",
      unit: "ms",
    }),
    messagesSent: meter.createCounter(WORKFLOW_METRIC_NAMES.messagesSent, {
      description: "Count of workflow messages sent.",
    }),
    messageWaitLatency: meter.createHistogram(WORKFLOW_METRIC_NAMES.messageWaitLatency, {
      description: "Latency from workflow message wait creation to message receipt.",
      unit: "ms",
    }),
    hooksResumed: meter.createCounter(WORKFLOW_METRIC_NAMES.hooksResumed, {
      description: "Count of workflow hooks resumed.",
    }),
    hookResumeLatency: meter.createHistogram(WORKFLOW_METRIC_NAMES.hookResumeLatency, {
      description: "Latency from workflow hook wait creation to hook resume message receipt.",
      unit: "ms",
    }),
    streamUpdates: meter.createCounter(WORKFLOW_METRIC_NAMES.streamUpdates, {
      description: "Count of workflow stream updates.",
    }),
    cleanupDeletedRuns: meter.createCounter(WORKFLOW_METRIC_NAMES.cleanupDeletedRuns, {
      description: "Count of workflow runs deleted by cleanup or retention operations.",
    }),
    workerClaims: meter.createCounter(WORKFLOW_METRIC_NAMES.workerClaims, {
      description: "Count of workflow run claims by workers.",
    }),
    workerClaimFailures: meter.createCounter(WORKFLOW_METRIC_NAMES.workerClaimFailures, {
      description: "Count of failed targeted workflow run claims by workers.",
    }),
    workerHeartbeatFailures: meter.createCounter(WORKFLOW_METRIC_NAMES.workerHeartbeatFailures, {
      description: "Count of failed workflow worker heartbeat lease extensions.",
    }),
    workerLeaseExtensions: meter.createCounter(WORKFLOW_METRIC_NAMES.workerLeaseExtensions, {
      description: "Count of workflow run lease extension attempts.",
    }),
    workerLeaseReleases: meter.createCounter(WORKFLOW_METRIC_NAMES.workerLeaseReleases, {
      description: "Count of workflow run lease releases.",
    }),
    pendingToClaimedLatency: meter.createHistogram(WORKFLOW_METRIC_NAMES.pendingToClaimedLatency, {
      description: "Latency from workflow availability to worker claim in milliseconds.",
      unit: "ms",
    }),
    waitingToResumedLatency: meter.createHistogram(
      WORKFLOW_METRIC_NAMES.runWaitingToResumedLatency,
      {
        description: "Latency from workflow waiting state to resumed execution in milliseconds.",
        unit: "ms",
      },
    ),
    retryScheduled: meter.createCounter(WORKFLOW_METRIC_NAMES.retryScheduled, {
      description: "Count of workflow retries scheduled.",
    }),
    retryExhausted: meter.createCounter(WORKFLOW_METRIC_NAMES.retryExhausted, {
      description: "Count of workflow retries exhausted into permanent failure.",
    }),
    retryDelay: meter.createHistogram(WORKFLOW_METRIC_NAMES.retryDelay, {
      description: "Delay until a scheduled workflow retry in milliseconds.",
      unit: "ms",
    }),
    scheduleDueToRunCreatedLatency: meter.createHistogram(
      WORKFLOW_METRIC_NAMES.scheduleDueToRunCreatedLatency,
      {
        description: "Latency from recurring schedule fire time to scheduled run creation.",
        unit: "ms",
      },
    ),
    storageOperationDuration: meter.createHistogram(
      WORKFLOW_METRIC_NAMES.storageOperationDuration,
      {
        description: "Workflow storage/backend operation duration in milliseconds.",
        unit: "ms",
      },
    ),
    storageOperationErrors: meter.createCounter(WORKFLOW_METRIC_NAMES.storageOperationErrors, {
      description: "Count of workflow storage/backend operation failures.",
    }),
  };
}
