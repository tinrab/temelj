import type { RunId } from "../../src/types/run.ts";
import type { ReadStreamOptions, StreamState } from "../../src/types/stream.ts";
import type {
  Timeline,
  TimelineMessageEntry,
  TimelineSleepEntry,
} from "../../src/types/timeline.ts";
import type { WorkflowWorkerRunResult } from "../../src/types/worker.ts";
import type {
  WorkflowResumeWorkflowHookOptions,
  WorkflowResumeWorkflowWebhookOptions,
  WorkflowTestEventInspector,
  WorkflowTestReplayOptions,
  WorkflowTestRunnableHandle,
  WorkflowTestRunHandle,
  WorkflowTestRunWaker,
  WorkflowTestMessageSender,
  WorkflowTestStreamReader,
  WorkflowTestWebhookResumer,
  WorkflowTestWaitOptions,
  WorkflowWakeWorkflowRunOptions,
} from "../schema.ts";

import { nonNegativeTimerDelay } from "../../src/timer.ts";
import { StreamIdOrName } from "../../src/types/stream-id.ts";

interface WorkflowTestMessageReference {
  readonly messageId: string;
}

interface WorkflowTestRunReference {
  readonly runId: RunId;
}

export async function waitFor(callback: () => Promise<boolean>): Promise<void> {
  const startedAt = Temporal.Now.instant();
  while (!(await callback())) {
    if (Temporal.Now.instant().epochMilliseconds - startedAt.epochMilliseconds > 1_000) {
      throw new Error("Timed out while waiting for workflow test condition");
    }
    await delay(1);
  }
}

export async function delay(duration: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

/** Waits until a test workflow run reaches an active sleep entry. */
export async function waitForWorkflowSleep(
  handle: WorkflowTestRunHandle,
  options: WorkflowTestWaitOptions = {},
): Promise<TimelineSleepEntry> {
  requireWorkflowTestWaitOptions(options, "Workflow sleep wait options");
  return await waitForTimelineEntry(handle, options, "sleep", findActiveSleepEntry);
}

/** Waits until a test workflow run reaches an active hook entry. */
export async function waitForHook(
  handle: WorkflowTestRunHandle,
  options: WorkflowTestWaitOptions = {},
): Promise<TimelineMessageEntry & { readonly status: "waiting" }> {
  requireWorkflowTestWaitOptions(options, "Workflow hook wait options");
  return await waitForTimelineEntry(handle, options, "hook", findActiveHookEntry);
}

/** Processes a single test workflow run by run ID. */
export async function wakeWorkflowRun(
  waker: WorkflowTestRunWaker,
  handle: WorkflowTestRunnableHandle,
  options: WorkflowWakeWorkflowRunOptions = {},
): Promise<WorkflowWorkerRunResult> {
  await waker.workers.processRun(handle.runId, options);
  return { processedRuns: 1 };
}

/** Sends the message payload that resumes a test workflow hook. */
export async function resumeHook(
  sender: WorkflowTestMessageSender,
  hook: WorkflowTestMessageReference,
  runId: RunId,
  options: WorkflowResumeWorkflowHookOptions = {},
): Promise<void> {
  await sender.messages.send(runId, {
    messageId: hook.messageId,
    ...(options.payload === undefined ? {} : { payload: options.payload }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
  });
}

/** Resumes a test workflow webhook through a webhook resumer. */
export async function resumeWebhook(
  resumer: WorkflowTestWebhookResumer,
  token: string,
  options: WorkflowResumeWorkflowWebhookOptions = {},
): Promise<void> {
  await resumer.hooks.resumeWebhook(token, options);
}

/** Reads a durable stream from a test workflow run. */
export async function readStream<TChunk = unknown>(
  reader: WorkflowTestStreamReader,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  options?: ReadStreamOptions,
): Promise<StreamState<TChunk>> {
  return await reader.streams.read<TChunk>(runId, streamIdOrName, options);
}

/** Validates no duplicate workflow events after replay and throws when the requirement is not met. */
export async function requireNoDuplicateWorkflowEventsAfterReplay(
  inspector: WorkflowTestEventInspector,
  handle: WorkflowTestRunReference,
  replay: () => Promise<unknown>,
  options: WorkflowTestReplayOptions = {},
): Promise<void> {
  const before = await inspector.runs.events(handle.runId);
  await replay();
  const after = await inspector.runs.events(handle.runId);
  if (after.length === before.length) {
    return;
  }
  const label = options.label ?? "workflow replay";
  throw new Error(
    `${label} appended ${after.length - before.length} workflow event(s) for run ` +
      `${handle.runId}; expected replay to reuse existing durable history`,
  );
}

async function waitForTimelineEntry<TEntry>(
  handle: WorkflowTestRunHandle,
  options: WorkflowTestWaitOptions,
  label: "hook" | "sleep",
  findEntry: (timeline: Timeline, options: WorkflowTestWaitOptions) => TEntry | undefined,
): Promise<TEntry> {
  const startedAt = Temporal.Now.instant();
  const timeout = options.timeout ?? Temporal.Duration.from({ seconds: 1 });
  const pollInterval = options.pollInterval ?? Temporal.Duration.from({ milliseconds: 10 });
  const deadlineAt = startedAt.add(timeout);
  const pollDelay = nonNegativeTimerDelay(pollInterval, `Workflow ${label} wait pollInterval`);

  let latestTimeline: Timeline | undefined;
  while (true) {
    latestTimeline = await handle.timeline();
    const entry = findEntry(latestTimeline, options);
    if (entry !== undefined) {
      return entry;
    }
    if (Temporal.Instant.compare(Temporal.Now.instant(), deadlineAt) >= 0) {
      const status = await handle.status();
      throw new Error(
        `Timed out waiting for workflow ${label} in run ${handle.runId}; ` +
          `expected ${describeExpectedEntry(options)}, run status ${status}, ` +
          `observed ${describeTimeline(latestTimeline)}`,
      );
    }
    await delay(pollDelay.clampedDelay);
  }
}

function findActiveSleepEntry(
  timeline: Timeline,
  options: WorkflowTestWaitOptions,
): TimelineSleepEntry | undefined {
  return timeline.entries.findLast(
    (entry): entry is TimelineSleepEntry =>
      entry.kind === "sleep" &&
      entry.status === "started" &&
      matchesStepFilter(entry, options) &&
      !hasLaterSleepTerminal(timeline, entry),
  );
}

function findActiveHookEntry(
  timeline: Timeline,
  options: WorkflowTestWaitOptions,
): (TimelineMessageEntry & { readonly status: "waiting" }) | undefined {
  return timeline.entries.findLast(
    (entry): entry is TimelineMessageEntry & { readonly status: "waiting" } =>
      entry.kind === "message" &&
      entry.status === "waiting" &&
      matchesStepFilter(entry, options) &&
      !hasLaterMessageWaitTerminal(timeline, entry),
  );
}

function hasLaterSleepTerminal(timeline: Timeline, started: TimelineSleepEntry): boolean {
  return timeline.entries.some(
    (entry) =>
      entry.kind === "sleep" &&
      entry.stepId === started.stepId &&
      Temporal.Instant.compare(entry.timestamp, started.timestamp) > 0 &&
      entry.status === "completed",
  );
}

function hasLaterMessageWaitTerminal(timeline: Timeline, started: TimelineMessageEntry): boolean {
  return timeline.entries.some(
    (entry) =>
      entry.kind === "message" &&
      entry.stepId === started.stepId &&
      Temporal.Instant.compare(entry.timestamp, started.timestamp) > 0 &&
      (entry.status === "received" || entry.status === "failed"),
  );
}

function matchesStepFilter(
  entry: { readonly stepId?: string; readonly stepName?: string },
  options: WorkflowTestWaitOptions,
): boolean {
  return (
    (options.stepId === undefined || entry.stepId === options.stepId) &&
    (options.name === undefined || entry.stepName === options.name)
  );
}

function requireWorkflowTestWaitOptions(options: unknown, label: string): void {
  const value = options as WorkflowTestWaitOptions;
  if (value.timeout !== undefined) {
    nonNegativeTimerDelay(value.timeout, `${label} timeout`);
  }
  if (value.pollInterval !== undefined) {
    nonNegativeTimerDelay(value.pollInterval, `${label} pollInterval`);
  }
}

function describeExpectedEntry(options: WorkflowTestWaitOptions): string {
  return (
    [
      options.name === undefined ? undefined : `name ${options.name}`,
      options.stepId === undefined ? undefined : `step ${options.stepId}`,
    ]
      .filter((part) => part !== undefined)
      .join(", ") || "any active entry"
  );
}

function describeTimeline(timeline: Timeline): string {
  if (timeline.entries.length === 0) {
    return "no timeline entries";
  }
  return timeline.entries
    .map((entry) => {
      if ("stepId" in entry && entry.stepId !== undefined) {
        return `${entry.kind}:${entry.status}:${entry.stepId}`;
      }
      return `${entry.kind}:${entry.status}`;
    })
    .join(", ");
}
