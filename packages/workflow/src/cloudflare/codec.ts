import type { StorageValue } from "@temelj/storage";

import { createSuperJsonStorageCodec } from "@temelj/storage";
import { z } from "zod";

const cloudflareWorkflowCodec = createSuperJsonStorageCodec<StorageValue, "string">({
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

export function encodeCloudflareWorkflowValue(value: unknown): string {
  return cloudflareWorkflowCodec.encode(value as StorageValue);
}

export function decodeCloudflareWorkflowValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be an encoded string`);
  }
  return cloudflareWorkflowCodec.decode(value);
}

export function parseCloudflareWorkflowEnvelope(value: unknown): CloudflareWorkflowEnvelope {
  const parsed = cloudflareWorkflowEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("Cloudflare Workflow payload is not a valid Temelj workflow envelope");
  }
  return parsed.data;
}
