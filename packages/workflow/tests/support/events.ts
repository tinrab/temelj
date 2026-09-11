import type { StorageValue } from "@temelj/storage";

import { isObject } from "@temelj/value";

/** Returns whether a storage value ends with a workflow message-sent event. */
export function isMessageSentEventList(value: StorageValue | undefined): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  const last = value.at(-1);

  return isObject(last) && "kind" in last && last.kind === "message_sent";
}
