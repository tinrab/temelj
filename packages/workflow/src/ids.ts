import type { RecordedIdContext } from "./types/engine-options.ts";
import type { WorkerId } from "./types/ids.ts";

/** Converts arbitrary command ID text into a stable segment safe for recorded IDs. */
function sanitizeRecordedIdPart(value: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");

  return sanitized === "" ? "run" : sanitized;
}

/** Creates a default worker identifier using the current time and a random suffix. */
export function createDefaultWorkerId(): WorkerId {
  const timestamp = Temporal.Now.instant().epochMilliseconds.toString(36);

  return `worker_${timestamp}_${Math.random().toString(36).slice(2)}`;
}

export function createDefaultRunIdFactory(
  now: () => Temporal.Instant = Temporal.Now.instant,
): () => string {
  return () => `run_${now().epochMilliseconds.toString(36)}_${randomIdPart()}`;
}

export function createDefaultRecordedIdFactory(
  createRunId: () => string,
): (context: RecordedIdContext) => string {
  return (context) => `wf_${sanitizeRecordedIdPart(context.runId)}_${createRunId()}`;
}

function randomIdPart(): string {
  return Math.random().toString(36).slice(2);
}
