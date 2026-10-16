import { ss, type SchemaOutput } from "@temelj/standard-schema";

import type { EventRecord } from "./types/events.ts";
import type { AttributePatch, WorkflowAttributeValue, RunAttributes } from "./types/run.ts";

import { keyedRecord, parse } from "./schema/common.ts";

interface AttributeEventPatch {
  readonly attributes?: RunAttributes;
  readonly removeAttributes?: readonly string[];
}

export function normalizeAttributePatch(value: AttributePatch): AttributePatch {
  parse(attributePatchSchema, value);

  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function workflowAttributeEventPatch(patch: AttributePatch): AttributeEventPatch {
  const attributes = Object.fromEntries(
    Object.entries(patch).filter(
      (entry): entry is [string, WorkflowAttributeValue] => entry[1] !== undefined,
    ),
  );

  const removeAttributes = Object.entries(patch)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);

  return {
    ...(Object.keys(attributes).length > 0 && { attributes }),
    ...(removeAttributes.length > 0 && { removeAttributes }),
  };
}

export function workflowAttributePatchFromEvent(
  event: Extract<EventRecord, { readonly kind: "attributes_set" }>,
): AttributePatch {
  return {
    ...event.attributes,
    ...Object.fromEntries((event.removeAttributes ?? []).map((key) => [key, undefined] as const)),
  };
}

export function applyAttributePatch(
  current: RunAttributes | undefined,
  patch: AttributePatch,
): RunAttributes | undefined {
  const next = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  const entries = Object.entries(next).sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

const WORKFLOW_ATTRIBUTE_MAX_KEY_LENGTH = 128;

const WORKFLOW_ATTRIBUTE_MAX_COUNT = 64;

const WORKFLOW_ATTRIBUTE_MAX_VALUE_BYTES = 1_024;

const WORKFLOW_ATTRIBUTE_RESERVED_PREFIX = "$";

const attributeKeySchema = ss.refine(
  ss.refine(
    ss.refine(
      ss.string(),
      (key) => key.trim() !== "",
      "Workflow run attribute keys must not be empty",
    ),
    (key) => key.length <= WORKFLOW_ATTRIBUTE_MAX_KEY_LENGTH,
    `Workflow run attribute key must not exceed ${WORKFLOW_ATTRIBUTE_MAX_KEY_LENGTH} characters`,
  ),
  (key) => !key.startsWith(WORKFLOW_ATTRIBUTE_RESERVED_PREFIX),
  `Workflow run attribute key uses reserved prefix ${WORKFLOW_ATTRIBUTE_RESERVED_PREFIX}`,
);

const attributePrimitiveValueSchema = ss.union([
  ss.string(),
  ss.number(),
  ss.boolean(),
  ss.literal(null),
]);

export const attributeValueSchema = ss.refine(
  attributePrimitiveValueSchema,
  (value) => encodedAttributeByteLength(value) <= WORKFLOW_ATTRIBUTE_MAX_VALUE_BYTES,
  `Workflow run attribute value must not exceed ${WORKFLOW_ATTRIBUTE_MAX_VALUE_BYTES} encoded bytes`,
);

export const runAttributesSchema = ss.refine(
  keyedRecord(attributeKeySchema, attributeValueSchema),
  (attributes) => Object.keys(attributes).length <= WORKFLOW_ATTRIBUTE_MAX_COUNT,
  `Workflow run attributes must not include more than ${WORKFLOW_ATTRIBUTE_MAX_COUNT} keys`,
);

const attributePatchSchema = ss.refine(
  keyedRecord(attributeKeySchema, ss.optional(attributeValueSchema)),
  (attributes) => Object.keys(attributes).length <= WORKFLOW_ATTRIBUTE_MAX_COUNT,
  `Workflow run attributes must not include more than ${WORKFLOW_ATTRIBUTE_MAX_COUNT} keys`,
);

function encodedAttributeByteLength(
  value: SchemaOutput<typeof attributePrimitiveValueSchema>,
): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
