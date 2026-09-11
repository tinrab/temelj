import type { Logger } from "@temelj/log";

import type { WorkflowBundle } from "../bundle.ts";
import type { CreateCloudflareWorkflowEntrypointOptions } from "./entrypoint.ts";
import type {
  CloudflareWorkflowRuntime,
  CreateCloudflareWorkflowRuntimeOptions,
} from "./runtime.ts";
import type { CloudflareWorkflowBinding } from "./types.ts";

import { Registry } from "../registry.ts";
import { createCloudflareWorkflowEntrypoint } from "./entrypoint.ts";
import { createCloudflareWorkflowRuntime } from "./runtime.ts";

export interface CreateCloudflareWorkflowHostOptions {
  readonly workflows: WorkflowBundle;
  readonly logger?: Logger;
}

export type CreateCloudflareWorkflowHostRuntimeOptions = Omit<
  CreateCloudflareWorkflowRuntimeOptions,
  "binding" | "registration" | "registry"
>;

export interface CloudflareWorkflowHost<TEnv> {
  readonly Entrypoint: ReturnType<typeof createCloudflareWorkflowEntrypoint<TEnv>>;
  createRuntime(
    binding: CloudflareWorkflowBinding,
    options?: CreateCloudflareWorkflowHostRuntimeOptions,
  ): CloudflareWorkflowRuntime;
}

/** Creates a Cloudflare host backed by one immutable workflow bundle. */
export function createCloudflareWorkflowHost<TEnv = unknown>(
  options: CreateCloudflareWorkflowHostOptions,
): CloudflareWorkflowHost<TEnv> {
  const registry = new Registry(options.workflows.workflows);

  const entrypointOptions: CreateCloudflareWorkflowEntrypointOptions = { registry };

  if (options.logger !== undefined) {
    Object.assign(entrypointOptions, {
      logger: options.logger,
    } satisfies Partial<CreateCloudflareWorkflowEntrypointOptions>);
  }

  return {
    Entrypoint: createCloudflareWorkflowEntrypoint<TEnv>(entrypointOptions),
    createRuntime(binding, runtimeOptions = {}) {
      return createCloudflareWorkflowRuntime({
        ...runtimeOptions,
        binding,
        registry,
        registration: "static",
      });
    },
  };
}
