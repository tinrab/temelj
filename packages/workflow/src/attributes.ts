import type { EventRecord } from "./types/events.ts";
import type {
  WorkflowAttributePatch,
  WorkflowAttributeValue,
  WorkflowRunAttributes,
} from "./types/run.ts";

import { workflowAttributePatchSchema } from "./types/run.ts";

export interface WorkflowAttributeEventPatch {
  readonly attributes?: WorkflowRunAttributes;
  readonly removeAttributes?: readonly string[];
}

export function normalizeWorkflowAttributePatch(
  value: WorkflowAttributePatch,
): WorkflowAttributePatch {
  workflowAttributePatchSchema.parse(value);
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function workflowAttributeEventPatch(
  patch: WorkflowAttributePatch,
): WorkflowAttributeEventPatch {
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
): WorkflowAttributePatch {
  return {
    ...event.attributes,
    ...Object.fromEntries((event.removeAttributes ?? []).map((key) => [key, undefined] as const)),
  };
}

export function applyWorkflowAttributePatch(
  current: WorkflowRunAttributes | undefined,
  patch: WorkflowAttributePatch,
): WorkflowRunAttributes | undefined {
  const next: Record<string, WorkflowAttributeValue> = { ...current };
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
