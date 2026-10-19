import type { CompiledWorkflowFunction } from "./client.ts";
import type { RegistryLike, WorkflowDefinition, WorkflowImplementation } from "./definition.ts";
import type { RunId } from "./ids.ts";
import type { ResultOptions } from "./result.ts";
import type { RunArguments, StartOptions } from "./run-options.ts";
import type { RunRecord, RunStatus } from "./run.ts";

/** What every host can do with a run it started. */
export interface RunHandle<TOutput = unknown> {
  readonly runId: RunId;
  /** Workflow definition name stored on the run. */
  readonly workflowName: string;
  /** Workflow version stored on the run, when one was resolved. */
  readonly workflowVersion?: string;
  getRun(): Promise<RunRecord>;
  status(): Promise<RunStatus>;
  /** Waits for and returns the completed workflow output. */
  result(options?: ResultOptions): Promise<TOutput>;
  /** Cancels this run if it has not already reached a terminal status. */
  cancel(): Promise<RunRecord>;
}

/**
 * What every host offers: the local client and the Cloudflare runtime both implement it, so
 * application code that sticks to it runs on either. Each host adds its own capabilities on top.
 */
export interface WorkflowRuntime extends Pick<RegistryLike, "implementWorkflow" | "register"> {
  readonly runs: RuntimeRunsApi;
  /** Flushes resources owned by this runtime. */
  close(): Promise<void>;
}

export interface RuntimeRunsApi {
  /** Starts a run of a definition. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowDefinition<TInput, TOutput, TRawInput>,
    ...args: RunArguments<TRawInput, StartOptions>
  ): Promise<RunHandle<TOutput>>;
  /** Registers an implementation when needed, then starts a run of it. */
  start<TInput, TOutput, TRawInput = TInput>(
    workflow: WorkflowImplementation<TInput, TOutput, TRawInput>,
    ...args: RunArguments<TRawInput, StartOptions>
  ): Promise<RunHandle<TOutput>>;
  /** Starts a compiled workflow function produced by the workflow transform. */
  start<TArgs extends readonly unknown[], TOutput>(
    workflow: CompiledWorkflowFunction<TArgs, TOutput>,
    ...args: TArgs
  ): Promise<RunHandle<Awaited<TOutput>>>;
}
