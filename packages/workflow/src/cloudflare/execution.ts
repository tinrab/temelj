import type { Logger } from "@temelj/log";

import type { RegistryLike } from "../types/definition.ts";
import type { CreateCloudflareContextOptions } from "./step.ts";
import type {
  CloudflareNonRetryableErrorConstructor,
  CloudflareWorkflowEvent,
  CloudflareWorkflowStep,
} from "./types.ts";

import { parseInput } from "../engine/serialization.ts";
import { WorkflowCapabilityError } from "../errors/mod.ts";
import {
  type CloudflareResultEnvelope,
  decodeCloudflareValue,
  encodeCloudflareValue,
  parseCloudflareEnvelope,
} from "./codec.ts";
import { resolveCloudflareWorkflowImplementation } from "./registry.ts";
import { createCloudflareContext } from "./step.ts";

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
  const envelope = parseCloudflareEnvelope(event.payload);

  const implementation = resolveCloudflareWorkflowImplementation(
    options.registry,
    envelope.workflowName,
    envelope.workflowVersion,
  );

  if (implementation.config.retry !== undefined) {
    WorkflowCapabilityError.unsupported("Cloudflare workflow-level retry configuration");
  }

  const rawInput = decodeCloudflareValue(envelope.input, "Cloudflare Workflow input");
  const input = await parseInput(implementation.definition, rawInput);

  const result: CreateCloudflareContextOptions<typeof input> = {
    input,
    step,
    runId: event.instanceId,
    workflowName: implementation.name,
    workflowVersion: implementation.version,
    createdAt: Temporal.Instant.fromEpochMilliseconds(event.timestamp.getTime()),
    logger: options.logger,
    nonRetryableError: options.nonRetryableError,
  };

  const contextOptions: CreateCloudflareContextOptions<typeof input> = result;
  const context = createCloudflareContext(contextOptions);

  const output: CloudflareResultEnvelope = {
    kind: "temelj-workflow-result",
    version: 1,
    workflowName: implementation.name,
    output: encodeCloudflareValue(await implementation.handler(context)),
    workflowVersion: implementation.version,
  };

  return JSON.stringify(output);
}
