import type { StorageValue } from "@temelj/storage";

import { ss, type Schema } from "@temelj/standard-schema";
import { createSuperJsonStorageCodec } from "@temelj/storage";

import type { WorkflowDefinition } from "../types/definition.ts";
import type { CloudflareWorkflowInstanceStatus } from "./types.ts";

import { parse } from "../schema/common.ts";
import { persistedValueSchema } from "../schema/persisted-value.ts";
import { durationTotal } from "../temporal.ts";

const cloudflareCodec = createSuperJsonStorageCodec<StorageValue | undefined, "string">({
  format: "string",
});

const nonEmptyStringSchema = ss.nonEmptyString();

/** Serialized payload dispatched through the generic Cloudflare entrypoint. */
export interface CloudflareEnvelope {
  readonly kind: "temelj-workflow";
  readonly version: 1;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly input: string;
}

const cloudflareEnvelopeSchema: Schema<unknown, CloudflareEnvelope> = ss.object({
  kind: ss.literal("temelj-workflow"),
  version: ss.literal(1),
  workflowName: nonEmptyStringSchema,
  workflowVersion: ss.optional(nonEmptyStringSchema),
  input: ss.string(),
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Caller-defined workflow values are validated before crossing the Cloudflare transport boundary.
export function encodeCloudflareValue(value: unknown): string {
  return cloudflareCodec.encode(parse(ss.optional(persistedValueSchema), value));
}

export function decodeCloudflareValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Provider output is untrusted until the encoded string and decoded workflow value both validate.
  value: unknown,
  label: string,
): StorageValue | undefined {
  const encoded = ss.safeParseSync(ss.string(), value);

  if (!encoded.success) throw new TypeError(`${label} must be an encoded string`);

  return parse(ss.optional(persistedValueSchema), cloudflareCodec.decode(encoded.value));
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The native Cloudflare event payload enters through this envelope schema parser.
export function parseCloudflareEnvelope(value: unknown): CloudflareEnvelope {
  const parsed = ss.safeParseSync(cloudflareEnvelopeSchema, value);

  if (!parsed.success) {
    throw new TypeError("Cloudflare Workflow payload is not a valid Temelj workflow envelope");
  }

  return parsed.value;
}

/** Serialized result coupled to the workflow contract that produced it. */
export interface CloudflareResultEnvelope {
  readonly kind: "temelj-workflow-result";
  readonly version: 1;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly output: string;
}

const cloudflareResultEnvelopeSchema: Schema<unknown, CloudflareResultEnvelope> = ss.object({
  kind: ss.literal("temelj-workflow-result"),
  version: ss.literal(1),
  workflowName: nonEmptyStringSchema,
  workflowVersion: ss.optional(nonEmptyStringSchema),
  output: ss.string(),
});

/** Validates the provider result and its workflow identity before decoding the output. */
export function decodeCloudflareResult(
  state: CloudflareWorkflowInstanceStatus,
  definition: WorkflowDefinition,
): StorageValue | undefined {
  const envelope = parse(
    cloudflareResultEnvelopeSchema,
    JSON.parse(parse(ss.string(), state.output)),
  );

  if (
    envelope.workflowName !== definition.name ||
    envelope.workflowVersion !== definition.version
  ) {
    throw new TypeError(
      "Cloudflare Workflow result does not match the requested workflow name and version",
    );
  }

  return decodeCloudflareValue(envelope.output, "Cloudflare Workflow result output");
}

export function durationMilliseconds(duration: Temporal.Duration, label: string): number {
  const milliseconds = durationTotal(duration);

  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new RangeError(`${label} must resolve to non-negative whole milliseconds`);
  }

  return milliseconds;
}
