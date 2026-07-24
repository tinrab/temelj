/** Returns whether a storage value ends with a workflow message-sent event. */
export function isMessageSentEventList(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const last = value.at(-1);
  return (
    typeof last === "object" && last !== null && "kind" in last && last.kind === "message_sent"
  );
}
