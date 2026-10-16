import type { StorageValue } from "@temelj/storage";

import type { RunId } from "./ids.ts";
import type { PageOptions } from "./pagination.ts";

export type ScheduleId = string;

/** Lifecycle status of a stored recurring workflow schedule. */
export type ScheduleStatus = "active" | "paused" | "archived" | "deleted";

/** Policy for handling missed recurring schedule fire times. */
export type ScheduleCatchUpPolicy = "skip" | "one" | "all";

/** Policy for handling schedule ticks while a prior scheduled run is still active. */
export type ScheduleOverlapPolicy = "allow" | "skip" | "buffer" | "cancel";

/** Stored recurring workflow schedule state. */
export interface ScheduleRecord {
  readonly id: ScheduleId;
  readonly namespace: string;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly input?: StorageValue;
  readonly context?: StorageValue;
  readonly status: ScheduleStatus;
  readonly every: Temporal.Duration;
  readonly catchUp: ScheduleCatchUpPolicy;
  readonly maxCatchUpRuns?: number;
  readonly maxLateness?: Temporal.Duration;
  readonly overlap: ScheduleOverlapPolicy;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly nextFireAt: Temporal.Instant;
  readonly endAt?: Temporal.Instant;
  readonly bufferedFireAt?: Temporal.Instant;
  readonly lastFireAt?: Temporal.Instant;
  readonly lastRunId?: RunId;
  readonly tickCount: number;
}

/** Configuration for creating or replacing a recurring workflow schedule. */
export interface ScheduleConfig<TInput = unknown, TRawInput = TInput> {
  readonly id: ScheduleId;
  readonly every: Temporal.Duration;
  readonly input: TRawInput;
  readonly context?: unknown;
  readonly from?: Temporal.Instant;
  readonly endAt?: Temporal.Instant;
  readonly catchUp?: ScheduleCatchUpPolicy;
  readonly maxCatchUpRuns?: number;
  readonly maxLateness?: Temporal.Duration;
  readonly overlap?: ScheduleOverlapPolicy;
}

export interface ListSchedulesOptions {
  readonly status?: ScheduleStatus | readonly ScheduleStatus[];
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly limit?: number;
}

/** Paginated filters for listing recurring workflow schedules. */
export type ListSchedulesPageOptions = ListSchedulesOptions & PageOptions;

/** Options for advancing due recurring workflow schedules. */
export interface TickSchedulesOptions {
  readonly now?: Temporal.Instant;
  readonly limit?: number;
}

/** Summary returned after advancing due recurring workflow schedules. */
export interface TickSchedulesResult {
  readonly ticked: number;
  readonly runIds: readonly RunId[];
  readonly scheduleIds: readonly ScheduleId[];
  readonly nextScheduleAt?: Temporal.Instant;
}
