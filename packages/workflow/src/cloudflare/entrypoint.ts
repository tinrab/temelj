import type { Logger } from "@temelj/log";

import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import type { RegistryLike } from "../types/definition.ts";
import type { RunCloudflareWorkflowOptions } from "./execution.ts";
import type { CloudflareWorkflowEvent, CloudflareWorkflowStep } from "./types.ts";

import { runCloudflareWorkflow } from "./execution.ts";

export interface CreateCloudflareWorkflowEntrypointOptions {
  readonly registry: RegistryLike;
  readonly logger?: Logger;
}

/** Creates a Cloudflare Workflow entrypoint class that dispatches through a Temelj registry. */
export function createCloudflareWorkflowEntrypoint<TEnv = unknown>(
  options: CreateCloudflareWorkflowEntrypointOptions,
): typeof WorkflowEntrypoint<TEnv, unknown> {
  return class TemeljCloudflareWorkflowEntrypoint extends WorkflowEntrypoint<TEnv, unknown> {
    async run(event: CloudflareWorkflowEvent, step: CloudflareWorkflowStep): Promise<string> {
      const result = { registry: options.registry } satisfies Partial<RunCloudflareWorkflowOptions>;

      if (options.logger !== undefined) {
        Object.assign(result, {
          logger: options.logger,
        } satisfies Partial<RunCloudflareWorkflowOptions>);
      }

      const result1 = Object.assign(result, {
        nonRetryableError: NonRetryableError,
      } satisfies Partial<RunCloudflareWorkflowOptions>);

      const runOptions: RunCloudflareWorkflowOptions = result1;

      return await runCloudflareWorkflow(runOptions, event, step);
    }
  };
}
