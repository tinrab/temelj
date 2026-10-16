import type { RunId, StreamIdOrName } from "../types/ids.ts";
import type { ReadStreamOptions, StreamState } from "../types/stream.ts";
import type { Timeline, TimelineEntry } from "../types/timeline.ts";
import type { WorkerRunResult } from "../types/worker.ts";
import type {
  ResumeWorkflowHookOptions,
  TestEventInspector,
  TestReplayOptions,
  TestRunnableHandle,
  TestRunHandle,
  TestRunWaker,
  TestMessageSender,
  TestStreamReader,
  TestWaitOptions,
  WakeWorkflowRunOptions,
} from "./types.ts";

import { nonNegativeTimerDelay } from "../timer.ts";

type SleepStartedEntry = Extract<
  TimelineEntry,
  { readonly kind: "sleep"; readonly status: "started" }
>;

type MessageWaitingEntry = Extract<
  TimelineEntry,
  { readonly kind: "message"; readonly status: "waiting" }
>;

interface TestMessageReference {
  readonly messageId: string;
}

interface TestRunReference {
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
export async function waitForSleep(
  handle: TestRunHandle,
  options: TestWaitOptions = {},
): Promise<SleepStartedEntry> {
  requireTestWaitOptions(options, "Workflow sleep wait options");

  return await waitForTimelineEntry(handle, options, "sleep", findActiveSleepEntry);
}

/** Waits until a test workflow run reaches an active hook entry. */
export async function waitForHook(
  handle: TestRunHandle,
  options: TestWaitOptions = {},
): Promise<MessageWaitingEntry> {
  requireTestWaitOptions(options, "Workflow hook wait options");

  return await waitForTimelineEntry(handle, options, "hook", findActiveHookEntry);
}

/** Processes a single test workflow run by run ID. */
export async function wakeRun(
  waker: TestRunWaker,
  handle: TestRunnableHandle,
  options: WakeWorkflowRunOptions = {},
): Promise<WorkerRunResult> {
  await waker.workers.processRun(handle.runId, options);

  return { processedRuns: 1 };
}

/** Sends the message payload that resumes a test workflow hook. */
export async function resumeHook(
  sender: TestMessageSender,
  hook: TestMessageReference,
  runId: RunId,
  options: ResumeWorkflowHookOptions = {},
): Promise<void> {
  await sender.messages.send(runId, {
    messageId: hook.messageId,
    payload: options.payload,
    idempotencyKey: options.idempotencyKey,
  });
}

/** Reads a durable stream from a test workflow run. */
export async function readStream(
  reader: TestStreamReader,
  runId: RunId,
  streamIdOrName: StreamIdOrName,
  options?: ReadStreamOptions,
): Promise<StreamState> {
  return await reader.streams.read(runId, streamIdOrName, options);
}

/** Validates no duplicate workflow events after replay and throws when the requirement is not met. */
export async function requireNoDuplicateEventsAfterReplay<TResult>(
  inspector: TestEventInspector,
  handle: TestRunReference,
  replay: () => Promise<TResult>,
  options: TestReplayOptions = {},
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
  handle: TestRunHandle,
  options: TestWaitOptions,
  label: "hook" | "sleep",
  findEntry: (timeline: Timeline, options: TestWaitOptions) => TEntry | undefined,
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
  options: TestWaitOptions,
): SleepStartedEntry | undefined {
  return timeline.entries.findLast(
    (entry): entry is SleepStartedEntry =>
      entry.kind === "sleep" &&
      entry.status === "started" &&
      matchesStepFilter(entry.event, options) &&
      !hasLaterSleepTerminal(timeline, entry),
  );
}

function findActiveHookEntry(
  timeline: Timeline,
  options: TestWaitOptions,
): MessageWaitingEntry | undefined {
  return timeline.entries.findLast(
    (entry): entry is MessageWaitingEntry =>
      entry.kind === "message" &&
      entry.status === "waiting" &&
      matchesStepFilter(entry.event, options) &&
      !hasLaterMessageWaitTerminal(timeline, entry),
  );
}

function hasLaterSleepTerminal(timeline: Timeline, started: SleepStartedEntry): boolean {
  return timeline.entries.some(
    (entry) =>
      entry.kind === "sleep" &&
      "stepId" in entry.event &&
      entry.event.stepId === started.event.stepId &&
      Temporal.Instant.compare(entry.timestamp, started.timestamp) > 0 &&
      entry.status === "completed",
  );
}

function hasLaterMessageWaitTerminal(timeline: Timeline, started: MessageWaitingEntry): boolean {
  return timeline.entries.some(
    (entry) =>
      entry.kind === "message" &&
      "stepId" in entry.event &&
      entry.event.stepId === started.event.stepId &&
      Temporal.Instant.compare(entry.timestamp, started.timestamp) > 0 &&
      (entry.status === "received" || entry.status === "failed"),
  );
}

function matchesStepFilter(
  entry: { readonly stepId?: string; readonly stepName?: string },
  options: TestWaitOptions,
): boolean {
  return (
    (options.stepId === undefined || entry.stepId === options.stepId) &&
    (options.name === undefined || entry.stepName === options.name)
  );
}

function requireTestWaitOptions(options: TestWaitOptions, label: string): void {
  const value = options;

  if (value.timeout !== undefined) {
    nonNegativeTimerDelay(value.timeout, `${label} timeout`);
  }

  if (value.pollInterval !== undefined) {
    nonNegativeTimerDelay(value.pollInterval, `${label} pollInterval`);
  }
}

function describeExpectedEntry(options: TestWaitOptions): string {
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
      if ("stepId" in entry.event) {
        return `${entry.kind}:${entry.status}:${entry.event.stepId}`;
      }

      return `${entry.kind}:${entry.status}`;
    })
    .join(", ");
}
