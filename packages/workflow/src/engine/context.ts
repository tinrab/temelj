import type { Logger } from "@temelj/log";

import type { ExecutionLimits } from "../types/engine-options.ts";
import type { ObservationEmitter } from "../types/observation.ts";
import type { WorkflowStore } from "../types/store.ts";
import type { Telemetry } from "../types/telemetry.ts";

/** What engine operations share: the store, the clock, limits, IDs, logging, and observation. */
export interface EngineContext {
  readonly store: WorkflowStore;
  readonly now: () => Temporal.Instant;
  readonly limits: ExecutionLimits;
  readonly observation: ObservationEmitter;
  readonly telemetry?: Telemetry;
  readonly logger: Logger;
  readonly createRunId: () => string;
}
