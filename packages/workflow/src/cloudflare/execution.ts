import type { Logger } from "@temelj/log";

import type { RegistryLike } from "../types/definition.ts";
import type { CreateCloudflareWorkflowContextOptions } from "./step.ts";
import type {
  CloudflareNonRetryableErrorConstructor,
  CloudflareWorkflowEvent,
  CloudflareWorkflowStep,
} from "./types.ts";

import { parseWorkflowInput } from "../engine/serialization.ts";
import { WorkflowCapabilityError } from "../errors/mod.ts";
import {
  type CloudflareWorkflowResultEnvelope,
  decodeCloudflareWorkflowValue,
  encodeCloudflareWorkflowValue,
  parseCloudflareWorkflowEnvelope,
} from "./codec.ts";
import { resolveCloudflareWorkflowImplementation } from "./registry.ts";
import { createCloudflareWorkflowContext } from "./step.ts";

export interface RunCloudflareWorkflowOptions {
  readonly registry: RegistryLike;
  readonly logger?: Logger;
  readonly nonRetryableError?: CloudflareNonRetryableErrorConstructor;
}

/** Dispatches one Cloudflare Workflow invocation to a registered Temelj implementation. */
export async function runCloudflareWorkflow(
  options: RunCloudflareWorkflowOptions,
  event: CloudflareWorkflowEvent,
  step: CloudflareWorkflowStep,
): Promise<string> {
  const envelope = parseCloudflareWorkflowEnvelope(event.payload);

  const implementation = resolveCloudflareWorkflowImplementation(
    options.registry,
    envelope.workflowName,
    envelope.workflowVersion,
  );

  if (implementation.config.retry !== undefined) {
    WorkflowCapabilityError.unsupported("Cloudflare workflow-level retry configuration");
  }

  const rawInput = decodeCloudflareWorkflowValue(envelope.input, "Cloudflare Workflow input");
  const input = await parseWorkflowInput(implementation.definition, rawInput);

  const result = {
    input,
    step,
    runId: event.instanceId,
    workflowName: implementation.name,
  } satisfies Partial<CreateCloudflareWorkflowContextOptions<typeof input>>;

  if (implementation.version !== undefined) {
    Object.assign(result, { workflowVersion: implementation.version } satisfies Partial<
      CreateCloudflareWorkflowContextOptions<typeof input>
    >);
  }

  const result1 = Object.assign(result, {
    createdAt: Temporal.Instant.fromEpochMilliseconds(event.timestamp.getTime()),
  } satisfies Partial<CreateCloudflareWorkflowContextOptions<typeof input>>);

  if (options.logger !== undefined) {
    Object.assign(result1, { logger: options.logger } satisfies Partial<
      CreateCloudflareWorkflowContextOptions<typeof input>
    >);
  }

  if (options.nonRetryableError !== undefined) {
    Object.assign(result1, { nonRetryableError: options.nonRetryableError } satisfies Partial<
      CreateCloudflareWorkflowContextOptions<typeof input>
    >);
  }

  const contextOptions: CreateCloudflareWorkflowContextOptions<typeof input> = result1;
  const context = createCloudflareWorkflowContext(contextOptions);

  const output: CloudflareWorkflowResultEnvelope = {
    kind: "temelj-workflow-result",
    version: 1,
    workflowName: implementation.name,
    output: encodeCloudflareWorkflowValue(await implementation.handler(context)),
  };

  if (implementation.version !== undefined) {
    Object.assign(output, { workflowVersion: implementation.version });
  }

  return JSON.stringify(output);
}
