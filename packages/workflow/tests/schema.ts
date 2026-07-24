import { z } from "zod";

import type { EventRecord } from "../src/types/events.ts";
import type { SendMessageOptions } from "../src/types/message.ts";
import type { RunId, WorkflowRunStatus } from "../src/types/run.ts";
import type { StepId } from "../src/types/step.ts";
import type { ReadStreamOptions, StreamState } from "../src/types/stream.ts";
import type { Timeline } from "../src/types/timeline.ts";
import type { TransformResult } from "../src/types/vite.ts";
import type { WorkflowWakeDueRunsOptions, WorkflowWorkerRunResult } from "../src/types/worker.ts";

import { nonBlankStringSchema } from "../src/types/common.ts";
import { StreamIdOrName } from "../src/types/stream-id.ts";

export const workflowDirectiveFixtureSchema = z.object({
  id: nonBlankStringSchema,
  code: z.string(),
});

export const workflowDirectiveFixtureListSchema = z.array(workflowDirectiveFixtureSchema);

export const workflowDirectiveFixtureResultSchema = z.object({
  id: nonBlankStringSchema,
  result: z.unknown().optional(),
});

/** Describes the workflow test run handle contract. */
export interface WorkflowTestRunHandle {
  readonly runId: RunId;
  status(): Promise<WorkflowRunStatus>;
  timeline(): Promise<Timeline>;
}

/** Describes the workflow test message sender contract. */
export interface WorkflowTestMessageSender {
  readonly messages: {
    send(runId: RunId, options: SendMessageOptions): Promise<void>;
  };
}

/** Describes the workflow test webhook resumer contract. */
export interface WorkflowTestWebhookResumer {
  readonly hooks: {
    resumeWebhook(token: string, options?: WorkflowResumeWorkflowWebhookOptions): Promise<void>;
  };
}

/** Describes the workflow test stream reader contract. */
export interface WorkflowTestStreamReader {
  readonly streams: {
    read<TChunk = unknown>(
      runId: RunId,
      streamIdOrName: StreamIdOrName,
      options?: ReadStreamOptions,
    ): Promise<StreamState<TChunk>>;
  };
}

/** Describes the workflow test event inspector contract. */
export interface WorkflowTestEventInspector {
  readonly runs: {
    events(runId: RunId): Promise<readonly EventRecord[]>;
  };
}

/** Describes the workflow test run waker contract. */
export interface WorkflowTestRunWaker {
  readonly workers: {
    processRun(runId: RunId, options?: WorkflowWakeWorkflowRunOptions): Promise<unknown>;
    wakeDueRuns(options?: WorkflowWakeDueRunsOptions): Promise<WorkflowWorkerRunResult>;
  };
}

/** Describes the workflow test runnable handle contract. */
export interface WorkflowTestRunnableHandle {
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
}

/** Options for workflow test wait. */
export interface WorkflowTestWaitOptions {
  readonly name?: string;
  readonly stepId?: StepId;
  readonly timeout?: Temporal.Duration;
  readonly pollInterval?: Temporal.Duration;
}

/** Options for workflow resume workflow hook. */
export interface WorkflowResumeWorkflowHookOptions {
  readonly payload?: unknown;
  readonly idempotencyKey?: string;
}

/** Options for workflow resume workflow webhook. */
export type WorkflowResumeWorkflowWebhookOptions = WorkflowResumeWorkflowHookOptions;

/** Options for workflow test replay. */
export interface WorkflowTestReplayOptions {
  readonly label?: string;
}

/** Describes the workflow directive fixture contract. */
export type WorkflowDirectiveFixture = Readonly<z.infer<typeof workflowDirectiveFixtureSchema>>;

/** Result returned by workflow directive fixture. */
export type WorkflowDirectiveFixtureResult = Readonly<
  Omit<z.infer<typeof workflowDirectiveFixtureResultSchema>, "result">
> & {
  readonly result?: TransformResult;
};

/** Options for workflow wake workflow run. */
export type WorkflowWakeWorkflowRunOptions = Omit<
  WorkflowWakeDueRunsOptions,
  "maxRuns" | "workflowName" | "workflowVersion"
>;
