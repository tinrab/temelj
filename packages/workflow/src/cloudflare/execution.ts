import type { Logger } from "@temelj/log";

import type { RegistryLike } from "../types/definition.ts";
import type {
  CloudflareNonRetryableErrorConstructor,
  CloudflareWorkflowEvent,
  CloudflareWorkflowStep,
} from "./types.ts";

import { parseWorkflowInput } from "../definition.ts";
import { WorkflowCapabilityError } from "../errors/mod.ts";
import {
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
  const context = createCloudflareWorkflowContext({
    input,
    step,
    runId: event.instanceId,
    workflowName: implementation.name,
    ...(implementation.version === undefined ? {} : { workflowVersion: implementation.version }),
    createdAt: Temporal.Instant.fromEpochMilliseconds(event.timestamp.getTime()),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.nonRetryableError === undefined
      ? {}
      : { nonRetryableError: options.nonRetryableError }),
  });
  return encodeCloudflareWorkflowValue(await implementation.handler(context));
}
