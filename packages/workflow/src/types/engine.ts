import type { Logger } from "@temelj/log";

import type { History } from "../history/replay.ts";
import type {
  DeterministicBytesContext,
  RecordedIdContext,
  ExecutionLimits,
} from "./engine-options.ts";
import type { EventRecord } from "./events.ts";
import type { RunId } from "./ids.ts";
import type { RunRecord } from "./run.ts";
import type { WorkflowStore } from "./store.ts";
import type { Telemetry } from "./telemetry.ts";

/** Internal execution context used while replaying and advancing one workflow run. */
export interface ExecutionEnvironment {
  /** Store used to read and persist run state during execution. */
  readonly store: WorkflowStore;
  readonly runId: RunId;
  /** Replay history built from the run's durable events. */
  readonly history: History;
  /** Clock used for timestamps recorded by this execution. */
  readonly now: () => Temporal.Instant;
  /** Deterministic ID factory used for recorded workflow commands. */
  readonly createRecordedId: (context: RecordedIdContext) => string;
  /** Deterministic random-number factory used when first recording random commands. */
  readonly createDeterministicRandom: (context: RecordedIdContext) => number;
  /** Deterministic UUID factory used when first recording UUID commands. */
  readonly createDeterministicUuid: (context: RecordedIdContext) => string;
  /** Deterministic byte factory used when first recording byte commands. */
  readonly createDeterministicBytes: (context: DeterministicBytesContext) => Uint8Array;
  /** Maximum number of materialized step attempts allowed for this run. */
  readonly maximumStepAttemptsPerRun: number;
  /** Runtime execution limits enforced by the engine. */
  readonly limits: ExecutionLimits;
  /** Current run record that owns this execution attempt. */
  readonly executionOwner: RunRecord;
  /** Optional telemetry adapter used for workflow and step execution observations. */
  readonly telemetry?: Telemetry;
  /** Logger scoped to this execution. */
  readonly logger: Logger;
  /** Whether this execution is replaying previously-recorded durable events. */
  readonly replaying: boolean;
  /** Observer called after a durable event is appended. */
  readonly observeDurableEventAppended?: (
    runId: RunId,
    event: EventRecord,
    events: readonly EventRecord[],
  ) => void;
  /** Observer called after an external message is accepted for a run. */
  readonly observeMessageSent?: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "message_sent" }>,
  ) => void;
  /** Observer called after a child workflow start event is committed. */
  readonly observeChildWorkflowStarted?: (
    runId: RunId,
    event: Extract<EventRecord, { readonly kind: "child_workflow_started" }>,
  ) => void;
}
