import type { CloudflareWorkersModule } from "@cloudflare/workers-types";

/** Minimal Cloudflare Workflow binding used by the Temelj adapter. */
export interface CloudflareWorkflowBinding {
  create(options?: CloudflareWorkflowInstanceCreateOptions): Promise<CloudflareWorkflowInstance>;
  createBatch(
    items: readonly CloudflareWorkflowInstanceCreateOptions[],
  ): Promise<readonly CloudflareWorkflowInstance[]>;
  get(id: string): Promise<CloudflareWorkflowInstance>;
}

/** Parameters accepted when creating a Cloudflare Workflow instance. */
export interface CloudflareWorkflowInstanceCreateOptions {
  readonly id?: string;
  readonly params?: unknown;
}

/** Minimal Cloudflare Workflow instance used by the Temelj adapter. */
export interface CloudflareWorkflowInstance {
  readonly id: string;
  status(): Promise<CloudflareWorkflowInstanceStatus>;
  terminate(options?: { readonly rollback?: boolean }): Promise<void>;
  sendEvent(options: { readonly type: string; readonly payload?: unknown }): Promise<void>;
}

/** Status returned by a Cloudflare Workflow instance binding. */
export interface CloudflareWorkflowInstanceStatus {
  readonly status:
    | "queued"
    | "running"
    | "paused"
    | "errored"
    | "terminated"
    | "complete"
    | "waiting"
    | "waitingForPause"
    | "unknown";
  readonly error?: {
    readonly name: string;
    readonly message: string;
  };
  readonly output?: unknown;
}

/** Cloudflare's context for static and dynamic retry configurations. */
export type CloudflareWorkflowStepContext = CloudflareWorkersModule.WorkflowStepContext<
  CloudflareWorkersModule.WorkflowDelayDuration | CloudflareWorkersModule.WorkflowDelayFunction
>;

/** Cloudflare retry and timeout configuration used by a durable step. */
export type CloudflareWorkflowStepConfig = CloudflareWorkersModule.WorkflowStepConfig;

/** Event returned by Cloudflare after a matching `waitForEvent` call. */
export interface CloudflareWorkflowStepEvent<TPayload = unknown> {
  readonly payload: TPayload;
  readonly timestamp: Date;
  readonly type: string;
}

/** Minimal Cloudflare durable step API used by the Temelj adapter. */
export interface CloudflareWorkflowStep {
  do(
    name: string,
    config: CloudflareWorkflowStepConfig,
    callback: (context: CloudflareWorkflowStepContext) => Promise<string>,
  ): Promise<string>;
  sleep(name: string, duration: number): Promise<void>;
  sleepUntil(name: string, timestamp: number): Promise<void>;
  waitForEvent(
    name: string,
    options: { readonly type: string; readonly timeout: number },
  ): Promise<CloudflareWorkflowStepEvent>;
}

/** Event delivered to the generic Temelj Cloudflare entrypoint. */
export interface CloudflareWorkflowEvent<TPayload = unknown> {
  readonly payload: TPayload;
  readonly timestamp: Date;
  readonly instanceId: string;
  readonly workflowName: string;
  readonly schedule?: {
    readonly cron: string;
    readonly scheduledTime: number;
  };
}

/** Constructor used to convert Temelj non-retryable errors for Cloudflare. */
export interface CloudflareNonRetryableErrorConstructor {
  new (message: string, name?: string): Error;
}
