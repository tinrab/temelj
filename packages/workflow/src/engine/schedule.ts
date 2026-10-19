import type { StorageValue } from "@temelj/storage";

import { isPlainObject } from "@temelj/value";

import type { WorkflowDefinition } from "../types/definition.ts";
import type { ExecutionLimits } from "../types/engine-options.ts";
import type { RunId } from "../types/ids.ts";
import type {
  ScheduleId,
  ScheduleConfig,
  ScheduleRecord,
  ScheduleStatus,
  TickSchedulesOptions,
  TickSchedulesResult,
} from "../types/schedule.ts";
import type { WorkflowStore } from "../types/store.ts";
import type { WorkflowEngine } from "./create.ts";

import { defineFromName } from "../definition.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowScheduleError, matchesWorkflowError } from "../errors/mod.ts";
import { isActiveRunStatus } from "../run-status.ts";
import { cancelWorkflowRun } from "./run-service.ts";
import { enforceStorageValueSize, parseInput, toPersistedValue } from "./serialization.ts";

const MAX_SCHEDULE_UPSERT_ATTEMPTS = 3;

export async function resolveScheduleRecord<TInput, TOutput, TRawInput>(
  namespace: string,
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  options: ScheduleConfig<TInput, TRawInput>,
  createdAt: Temporal.Instant,
  limits: ExecutionLimits,
): Promise<ScheduleRecord> {
  const from = options.from ?? createdAt;
  const nextFireAt = from.toZonedDateTimeISO("UTC").add(options.every).toInstant();
  const endAt = options.endAt;
  const catchUp = options.catchUp ?? "one";
  const maxCatchUpRuns = options.maxCatchUpRuns;
  const overlap = options.overlap ?? "allow";
  const persistedInput = await parseInput(definition, options.input);
  enforceStorageValueSize(persistedInput, "workflow schedule input", limits);

  return {
    id: options.id,
    namespace,
    workflowName: definition.name,
    workflowVersion: definition.version,
    input: persistedInput,
    context:
      options.context !== undefined
        ? toPersistedValue(options.context, "workflow schedule context", limits)
        : undefined,
    status:
      endAt !== undefined && Temporal.Instant.compare(nextFireAt, endAt) > 0 ? "deleted" : "active",
    every: options.every,
    catchUp,
    maxCatchUpRuns,
    maxLateness: options.maxLateness,
    overlap,
    createdAt,
    updatedAt: createdAt,
    nextFireAt,
    endAt,
    tickCount: 0,
  };
}

export async function upsertSchedule<TInput, TOutput, TRawInput>(
  store: WorkflowStore,
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  options: ScheduleConfig<TInput, TRawInput>,
  timestamp: Temporal.Instant,
  limits: ExecutionLimits,
): Promise<ScheduleRecord> {
  const schedule = await resolveScheduleRecord(
    store.namespace,
    definition,
    options,
    timestamp,
    limits,
  );

  for (let attempt = 0; attempt < MAX_SCHEDULE_UPSERT_ATTEMPTS; attempt += 1) {
    const existing = await store.getSchedule(schedule.id);

    if (existing === undefined) {
      try {
        return await store.createSchedule(schedule);
      } catch (error) {
        if (
          !matchesWorkflowError(error, WorkflowErrorCode.SCHEDULE_ALREADY_EXISTS, {
            scheduleId: schedule.id,
          })
        ) {
          throw error;
        }

        continue;
      }
    }

    const next: ScheduleRecord = {
      ...schedule,
      createdAt: existing.createdAt,
      updatedAt: timestamp,
      tickCount: existing.tickCount,
      bufferedFireAt: existing.bufferedFireAt,
      lastFireAt: existing.lastFireAt,
      lastRunId: existing.lastRunId,
    };

    const updated = await store.updateScheduleIfCurrent(existing, next);

    if (updated !== undefined) {
      return updated;
    }
  }

  throw new WorkflowScheduleError(
    `Failed to upsert workflow schedule ${schedule.id}`,
    WorkflowErrorCode.SCHEDULE_UPSERT_CONFLICT_EXHAUSTED,
    { scheduleId: schedule.id },
  );
}

export async function updateScheduleStatus(
  store: WorkflowStore,
  scheduleId: ScheduleId,
  status: ScheduleStatus,
  now: Temporal.Instant,
): Promise<ScheduleRecord> {
  const current = await store.getSchedule(scheduleId);

  if (current === undefined) {
    throw new WorkflowScheduleError(
      `Workflow schedule not found: ${scheduleId}`,
      WorkflowErrorCode.SCHEDULE_NOT_FOUND,
      { scheduleId: scheduleId },
    );
  }

  const next = {
    ...current,
    status,
    updatedAt: now,
  };

  const updated = await store.updateScheduleIfCurrent(current, next);

  if (updated === undefined) {
    throw new WorkflowScheduleError(
      `Failed to update workflow schedule ${scheduleId}`,
      WorkflowErrorCode.SCHEDULE_UPDATE_CONFLICT_EXHAUSTED,
      { scheduleId: scheduleId },
    );
  }

  return updated;
}

function workflowScheduleFireTimes(
  schedule: ScheduleRecord,
  now: Temporal.Instant,
): readonly Temporal.Instant[] {
  if (schedule.bufferedFireAt !== undefined) {
    return [schedule.bufferedFireAt];
  }

  if (schedule.catchUp !== "all") {
    const fireAt =
      schedule.catchUp === "skip" && Temporal.Instant.compare(schedule.nextFireAt, now) < 0
        ? now
        : schedule.nextFireAt;

    return (schedule.endAt !== undefined && Temporal.Instant.compare(fireAt, schedule.endAt) > 0) ||
      (schedule.maxLateness !== undefined &&
        now.since(fireAt).total({ unit: "millisecond" }) >
          schedule.maxLateness.total({ unit: "millisecond" }))
      ? []
      : [fireAt];
  }

  const maxCatchUpRuns = schedule.maxCatchUpRuns ?? 10;
  const fireTimes: Temporal.Instant[] = [];
  let fireAt = schedule.nextFireAt;

  while (Temporal.Instant.compare(fireAt, now) <= 0) {
    if (schedule.endAt !== undefined && Temporal.Instant.compare(fireAt, schedule.endAt) > 0) {
      break;
    }

    if (
      !(
        schedule.maxLateness !== undefined &&
        now.since(fireAt).total({ unit: "millisecond" }) >
          schedule.maxLateness.total({ unit: "millisecond" })
      )
    ) {
      fireTimes.push(fireAt);

      if (fireTimes.length >= maxCatchUpRuns) {
        break;
      }
    }

    fireAt = fireAt.add(schedule.every);
  }

  return fireTimes;
}

async function advanceSchedule(
  store: WorkflowStore,
  schedule: ScheduleRecord,
  now: Temporal.Instant,
  updatedAt: Temporal.Instant,
  fired?: { readonly fireAt: Temporal.Instant; readonly runId: RunId },
): Promise<ScheduleRecord | undefined> {
  const base = fired?.fireAt ?? now;
  const nextFireAt = base.add(schedule.every);

  const next: ScheduleRecord = {
    ...schedule,
    nextFireAt,
    status:
      schedule.endAt !== undefined && Temporal.Instant.compare(nextFireAt, schedule.endAt) > 0
        ? "deleted"
        : schedule.status,
    updatedAt,
    tickCount: schedule.tickCount + (fired === undefined ? 0 : 1),
    bufferedFireAt: fired === undefined ? schedule.bufferedFireAt : undefined,
    lastFireAt: fired === undefined ? schedule.lastFireAt : fired.fireAt,
    lastRunId: fired === undefined ? schedule.lastRunId : fired.runId,
  };

  return await store.updateScheduleIfCurrent(schedule, next);
}

async function bufferSchedule(
  store: WorkflowStore,
  schedule: ScheduleRecord,
  fireTimes: readonly Temporal.Instant[],
  now: Temporal.Instant,
  updatedAt: Temporal.Instant,
): Promise<ScheduleRecord | undefined> {
  const bufferAt = schedule.bufferedFireAt ?? fireTimes.at(-1);
  const base = fireTimes.at(-1) ?? now;
  const nextFireAt = base.add(schedule.every);

  const next: ScheduleRecord = {
    ...schedule,
    nextFireAt,
    status:
      schedule.endAt !== undefined && Temporal.Instant.compare(nextFireAt, schedule.endAt) > 0
        ? "deleted"
        : schedule.status,
    updatedAt,
    bufferedFireAt: bufferAt,
  };

  return await store.updateScheduleIfCurrent(schedule, next);
}

async function hasActiveScheduledRun(
  store: WorkflowStore,
  schedule: ScheduleRecord,
): Promise<boolean> {
  if (schedule.lastRunId === undefined) {
    return false;
  }

  const run = await store.getRun(schedule.lastRunId);

  return run !== undefined && isActiveRunStatus(run.status);
}

async function cancelActiveScheduledRun(
  store: WorkflowStore,
  engine: WorkflowEngine,
  schedule: ScheduleRecord,
): Promise<void> {
  if (schedule.lastRunId === undefined) {
    return;
  }

  const run = await store.getRun(schedule.lastRunId);

  if (run !== undefined && isActiveRunStatus(run.status)) {
    await cancelWorkflowRun(engine.context, engine.lifecycle, schedule.lastRunId);
  }
}

export async function tickSchedules(
  store: WorkflowStore,
  engine: WorkflowEngine,
  now: () => Temporal.Instant,
  tickOptions: TickSchedulesOptions | undefined,
): Promise<TickSchedulesResult> {
  const tickNow = tickOptions?.now === undefined ? now() : tickOptions.now;
  const limit = tickOptions?.limit;

  const schedules = (await store.listSchedules({ status: "active" }))
    .filter(
      (schedule: ScheduleRecord) =>
        schedule.bufferedFireAt !== undefined ||
        Temporal.Instant.compare(schedule.nextFireAt, tickNow) <= 0,
    )
    .slice(0, limit);

  const runIds: RunId[] = [];
  const scheduleIds: ScheduleId[] = [];

  for (const schedule of schedules) {
    const hasActiveRun = await hasActiveScheduledRun(store, schedule);

    if (schedule.overlap === "skip" && hasActiveRun) {
      const skipped = await advanceSchedule(store, schedule, tickNow, tickNow);

      if (skipped !== undefined) {
        scheduleIds.push(skipped.id);
      }

      continue;
    }

    if (schedule.overlap === "cancel" && hasActiveRun) {
      await cancelActiveScheduledRun(store, engine, schedule);
    }

    let currentSchedule = schedule;
    let advancedSchedule = false;
    const fireTimes = workflowScheduleFireTimes(schedule, tickNow);

    if (schedule.overlap === "buffer" && hasActiveRun) {
      const buffered = await bufferSchedule(store, schedule, fireTimes, tickNow, tickNow);

      if (buffered !== undefined) {
        scheduleIds.push(buffered.id);
      }

      continue;
    }

    if (fireTimes.length === 0) {
      const skipped = await advanceSchedule(store, schedule, tickNow, tickNow);

      if (skipped !== undefined) {
        scheduleIds.push(skipped.id);
      }

      continue;
    }

    for (const fireAt of fireTimes) {
      const run = await engine.startWorkflow(
        defineFromName(schedule.workflowName, schedule.workflowVersion),
        schedule.input,
        {
          idempotencyKey: `schedule:${schedule.id}:${fireAt.toString()}`,
          availableAt: fireAt,
          context: scheduleRunContext(schedule, fireAt),
        },
      );

      const advanced = await advanceSchedule(store, currentSchedule, tickNow, tickNow, {
        fireAt,
        runId: run.runId,
      });

      if (advanced === undefined) {
        break;
      }

      currentSchedule = advanced;
      advancedSchedule = true;
      runIds.push(run.runId);

      engine.observation.emitScheduleRunCreated({
        scheduleId: schedule.id,
        runId: run.runId,
        workflowName: schedule.workflowName,
        workflowVersion: schedule.workflowVersion,
        fireAt,
        timestamp: tickNow,
      });
    }

    if (advancedSchedule) {
      scheduleIds.push(schedule.id);
    }
  }

  const nextScheduleAt = (await store.listSchedules({ status: "active", limit: 1 }))[0]?.nextFireAt;

  return {
    ticked: runIds.length,
    runIds,
    scheduleIds,
    nextScheduleAt,
  };
}

function scheduleRunContext(schedule: ScheduleRecord, fireAt: Temporal.Instant): StorageValue {
  if (schedule.context === undefined) {
    return {
      scheduleId: schedule.id,
      scheduleFireAt: fireAt.toString(),
    };
  }

  if (isPlainObject(schedule.context)) {
    return Object.assign({}, schedule.context, {
      scheduleId: schedule.id,
      scheduleFireAt: fireAt.toString(),
    });
  }

  return {
    value: schedule.context,
    scheduleId: schedule.id,
    scheduleFireAt: fireAt.toString(),
  };
}
