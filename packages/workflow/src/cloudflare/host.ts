import type { Logger } from "@temelj/log";

import type { WorkflowBundle } from "../bundle.ts";
import type {
  CloudflareWorkflowRuntime,
  CreateCloudflareWorkflowRuntimeOptions,
} from "./runtime.ts";
import type { CloudflareWorkflowBinding } from "./types.ts";

import { createWorkflowBundleRegistry } from "../bundle.ts";
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
  const registry = createWorkflowBundleRegistry(options.workflows);
  return {
    Entrypoint: createCloudflareWorkflowEntrypoint<TEnv>({
      registry,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    }),
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
