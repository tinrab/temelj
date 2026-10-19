import { ss, type SchemaOutput } from "@temelj/standard-schema";

import type { WorkflowClient } from "../types/client.ts";
import type { TransformResult } from "../types/compiler.ts";
import type { EventRecord } from "../types/events.ts";
import type { RunId, StepId } from "../types/ids.ts";
import type { SendMessageOptions } from "../types/message.ts";
import type { RunStatus } from "../types/run.ts";
import type { Timeline } from "../types/timeline.ts";
import type { WakeDueRunsOptions, WorkerRunResult } from "../types/worker.ts";

import { nonBlankStringSchema } from "../schema/common.ts";

const workflowDirectiveFixtureSchema = ss.object({
  id: nonBlankStringSchema,
  code: ss.string(),
});

const workflowDirectiveFixtureResultSchema = ss.object({
  id: nonBlankStringSchema,
  result: ss.optional(ss.unknown()),
});

export interface TestRunHandle {
  readonly runId: RunId;
  status(): Promise<RunStatus>;
  timeline(): Promise<Timeline>;
}

export interface TestMessageSender {
  readonly messages: {
    send(runId: RunId, options: SendMessageOptions): Promise<void>;
  };
}

export interface TestStreamReader {
  readonly streams: Pick<WorkflowClient["streams"], "read">;
}

export interface TestEventInspector {
  readonly runs: {
    events(runId: RunId): Promise<readonly EventRecord[]>;
  };
}

export interface TestRunWaker {
  readonly workers: {
    processRun(runId: RunId, options?: WakeWorkflowRunOptions): Promise<void>;
    wakeDueRuns(options?: WakeDueRunsOptions): Promise<WorkerRunResult>;
  };
}

export interface TestRunnableHandle {
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
}

export interface TestWaitOptions {
  readonly name?: string;
  readonly stepId?: StepId;
  readonly timeout?: Temporal.Duration;
  readonly pollInterval?: Temporal.Duration;
}

export interface ResumeWorkflowHookOptions {
  readonly payload?: unknown;
  readonly idempotencyKey?: string;
}

export interface TestReplayOptions {
  readonly label?: string;
}

export type DirectiveFixture = Readonly<SchemaOutput<typeof workflowDirectiveFixtureSchema>>;

export type DirectiveFixtureResult = Readonly<
  Omit<SchemaOutput<typeof workflowDirectiveFixtureResultSchema>, "result">
> & {
  readonly result?: TransformResult;
};

export type WakeWorkflowRunOptions = Omit<
  WakeDueRunsOptions,
  "maxRuns" | "workflowName" | "workflowVersion"
>;
