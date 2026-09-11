import type { StorageValue } from "@temelj/storage";

import { createSuperJsonStorageCodec } from "@temelj/storage";
import { z } from "zod";

import type { WorkflowDefinition } from "../types/definition.ts";
import type { CloudflareWorkflowInstanceStatus } from "./types.ts";

import { workflowPersistedValueSchema } from "../types/run.ts";

const cloudflareWorkflowCodec = createSuperJsonStorageCodec<StorageValue | undefined, "string">({
  format: "string",
});

const cloudflareWorkflowEnvelopeSchema = z.object({
  kind: z.literal("temelj-workflow"),
  version: z.literal(1),
  workflowName: z.string().min(1),
  workflowVersion: z.string().min(1).optional(),
  input: z.string(),
});

/** Serialized payload dispatched through the generic Cloudflare entrypoint. */
export type CloudflareWorkflowEnvelope = z.infer<typeof cloudflareWorkflowEnvelopeSchema>;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Caller-defined workflow values are validated before crossing the Cloudflare transport boundary.
export function encodeCloudflareWorkflowValue(value: unknown): string {
  return cloudflareWorkflowCodec.encode(workflowPersistedValueSchema.optional().parse(value));
}

export function decodeCloudflareWorkflowValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Provider output is untrusted until the encoded string and decoded workflow value both validate.
  value: unknown,
  label: string,
): StorageValue | undefined {
  const encoded = z.string().safeParse(value);

  if (!encoded.success) throw new TypeError(`${label} must be an encoded string`);

  return workflowPersistedValueSchema
    .optional()
    .parse(cloudflareWorkflowCodec.decode(encoded.data));
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The native Cloudflare event payload enters through this envelope schema parser.
export function parseCloudflareWorkflowEnvelope(value: unknown): CloudflareWorkflowEnvelope {
  const parsed = cloudflareWorkflowEnvelopeSchema.safeParse(value);

  if (!parsed.success) {
    throw new TypeError("Cloudflare Workflow payload is not a valid Temelj workflow envelope");
  }

  return parsed.data;
}

const cloudflareWorkflowResultEnvelopeSchema = z.object({
  kind: z.literal("temelj-workflow-result"),
  version: z.literal(1),
  workflowName: z.string().min(1),
  workflowVersion: z.string().min(1).optional(),
  output: z.string(),
});

/** Serialized result coupled to the workflow contract that produced it. */
export type CloudflareWorkflowResultEnvelope = z.infer<
  typeof cloudflareWorkflowResultEnvelopeSchema
>;

/** Validates the provider result and its workflow identity before decoding the output. */
export function decodeCloudflareWorkflowResult(
  state: CloudflareWorkflowInstanceStatus,
  definition: WorkflowDefinition,
): StorageValue | undefined {
  const envelope = cloudflareWorkflowResultEnvelopeSchema.parse(
    JSON.parse(z.string().parse(state.output)),
  );

  if (
    envelope.workflowName !== definition.name ||
    envelope.workflowVersion !== definition.version
  ) {
    throw new TypeError(
      "Cloudflare Workflow result does not match the requested workflow name and version",
    );
  }

  return decodeCloudflareWorkflowValue(envelope.output, "Cloudflare Workflow result output");
}
