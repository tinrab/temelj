import type { WorkflowDefinition } from "../types/definition.ts";
import type { WorkflowExecutionLimits } from "../types/engine-options.ts";
import type {
  WorkflowRunCanceler,
  WorkflowRunStarter,
  WorkflowScheduleRunObserver,
} from "../types/engine.ts";
import type { RunId } from "../types/run.ts";
import type {
  ScheduleId,
  ScheduleConfig,
  ScheduleRecord,
  ScheduleStatus,
  TickSchedulesOptions,
  TickSchedulesResult,
} from "../types/schedule.ts";
import type {
  WorkflowRunReaderRepository,
  WorkflowScheduleConditionalWriterRepository,
  WorkflowScheduleCreationRepository,
  WorkflowScheduleListerRepository,
  WorkflowScheduleReaderRepository,
  WorkflowStoreNamespace,
} from "../types/store.ts";

import { defineWorkflowFromName } from "../definition.ts";
import { WorkflowScheduleAlreadyExistsError, WorkflowScheduleError } from "../errors/mod.ts";
import { isActiveWorkflowRunStatus } from "../utility.ts";
import { toOptionalPersistedValue, toPersistedValue } from "./serialization.ts";

type WorkflowScheduleCommandStore = WorkflowStoreNamespace &
  WorkflowScheduleCreationRepository &
  WorkflowScheduleReaderRepository &
  WorkflowScheduleConditionalWriterRepository;

const MAX_SCHEDULE_UPSERT_ATTEMPTS = 3;

type WorkflowScheduleTickStore = WorkflowScheduleListerRepository &
  WorkflowScheduleConditionalWriterRepository &
  WorkflowRunReaderRepository;

type WorkflowScheduleTickEngine = WorkflowRunStarter &
  WorkflowRunCanceler &
  Partial<WorkflowScheduleRunObserver>;

export function resolveScheduleRecord<TInput, TOutput, TRawInput>(
  namespace: string,
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  options: ScheduleConfig<TInput, TRawInput>,
  createdAt: Temporal.Instant,
  limits: WorkflowExecutionLimits,
): ScheduleRecord<TInput> {
  const from = options.from ?? createdAt;
  const nextFireAt = from.toZonedDateTimeISO("UTC").add(options.every).toInstant();
  const endAt = options.endAt;
  const catchUp = options.catchUp ?? "one";
  const maxCatchUpRuns = options.maxCatchUpRuns;
  const overlap = options.overlap ?? "allow";
  const persistedInput = toOptionalPersistedValue(options.input, "workflow schedule input", limits);
  return {
    id: options.id,
    namespace,
    workflowName: definition.name,
    ...(definition.version === undefined ? {} : { workflowVersion: definition.version }),
    ...(persistedInput === undefined ? {} : { input: persistedInput as TInput }),
    ...(options.context === undefined
      ? {}
      : {
          context: toPersistedValue(options.context, "workflow schedule context", limits),
        }),
    status:
      endAt !== undefined && Temporal.Instant.compare(nextFireAt, endAt) > 0 ? "deleted" : "active",
    every: options.every,
    catchUp,
    ...(maxCatchUpRuns === undefined ? {} : { maxCatchUpRuns }),
    ...(options.maxLateness === undefined ? {} : { maxLateness: options.maxLateness }),
    overlap,
    createdAt,
    updatedAt: createdAt,
    nextFireAt,
    ...(endAt === undefined ? {} : { endAt }),
    tickCount: 0,
  };
}

export async function upsertSchedule<TInput, TOutput, TRawInput>(
  store: WorkflowScheduleCommandStore,
  definition: WorkflowDefinition<TInput, TOutput, TRawInput>,
  options: ScheduleConfig<TInput, TRawInput>,
  timestamp: Temporal.Instant,
  limits: WorkflowExecutionLimits,
): Promise<ScheduleRecord<TInput>> {
  const schedule = resolveScheduleRecord(store.namespace, definition, options, timestamp, limits);
  for (let attempt = 0; attempt < MAX_SCHEDULE_UPSERT_ATTEMPTS; attempt += 1) {
    const existing = await store.getSchedule(schedule.id);
    if (existing === undefined) {
      try {
        return await store.createSchedule(schedule);
      } catch (error) {
        if (!WorkflowScheduleAlreadyExistsError.isAlreadyExists(error, schedule.id)) {
          throw error;
        }
        continue;
      }
    }
    const next = {
      ...schedule,
      createdAt: existing.createdAt,
      updatedAt: timestamp,
      tickCount: existing.tickCount,
      ...(existing.bufferedFireAt === undefined ? {} : { bufferedFireAt: existing.bufferedFireAt }),
      ...(existing.lastFireAt === undefined ? {} : { lastFireAt: existing.lastFireAt }),
      ...(existing.lastRunId === undefined ? {} : { lastRunId: existing.lastRunId }),
    };
    const updated = await store.updateScheduleIfCurrent(existing, next);
    if (updated !== undefined) {
      return updated;
    }
  }
  WorkflowScheduleError.upsertConflictExhausted(schedule.id);
}

export async function updateScheduleStatus(
  store: WorkflowScheduleReaderRepository & WorkflowScheduleConditionalWriterRepository,
  scheduleId: ScheduleId,
  status: ScheduleStatus,
  now: Temporal.Instant,
): Promise<ScheduleRecord> {
  const current = await store.getSchedule(scheduleId);
  if (current === undefined) {
    WorkflowScheduleError.notFound(scheduleId);
  }
  const next = {
    ...current,
    status,
    updatedAt: now,
  };
  const updated = await store.updateScheduleIfCurrent(current, next);
  if (updated === undefined) {
    WorkflowScheduleError.updateConflictExhausted(scheduleId);
  }
  return updated;
}

export function workflowScheduleFireTimes(
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

export async function advanceSchedule(
  store: WorkflowScheduleConditionalWriterRepository,
  schedule: ScheduleRecord,
  now: Temporal.Instant,
  updatedAt: Temporal.Instant,
  fired?: { readonly fireAt: Temporal.Instant; readonly runId: RunId },
): Promise<ScheduleRecord | undefined> {
  const base = fired?.fireAt ?? now;
  const nextFireAt = base.add(schedule.every);
  const next = {
    ...schedule,
    nextFireAt,
    status:
      schedule.endAt !== undefined && Temporal.Instant.compare(nextFireAt, schedule.endAt) > 0
        ? "deleted"
        : schedule.status,
    updatedAt,
    tickCount: schedule.tickCount + (fired === undefined ? 0 : 1),
    ...(fired === undefined || schedule.bufferedFireAt === undefined
      ? {}
      : { bufferedFireAt: undefined }),
    ...(fired === undefined
      ? {}
      : {
          lastFireAt: fired.fireAt,
          lastRunId: fired.runId,
        }),
  };
  return await store.updateScheduleIfCurrent(schedule, next);
}

export async function bufferSchedule(
  store: WorkflowScheduleConditionalWriterRepository,
  schedule: ScheduleRecord,
  fireTimes: readonly Temporal.Instant[],
  now: Temporal.Instant,
  updatedAt: Temporal.Instant,
): Promise<ScheduleRecord | undefined> {
  const bufferAt = schedule.bufferedFireAt ?? fireTimes.at(-1);
  const base = fireTimes.at(-1) ?? now;
  const nextFireAt = base.add(schedule.every);
  const next = {
    ...schedule,
    nextFireAt,
    status:
      schedule.endAt !== undefined && Temporal.Instant.compare(nextFireAt, schedule.endAt) > 0
        ? "deleted"
        : schedule.status,
    updatedAt,
    ...(bufferAt === undefined ? {} : { bufferedFireAt: bufferAt }),
  };
  return await store.updateScheduleIfCurrent(schedule, next);
}

export async function hasActiveScheduledRun(
  store: WorkflowRunReaderRepository,
  schedule: ScheduleRecord,
): Promise<boolean> {
  if (schedule.lastRunId === undefined) {
    return false;
  }
  const run = await store.getRun(schedule.lastRunId);
  return run !== undefined && isActiveWorkflowRunStatus(run.status);
}

export async function cancelActiveScheduledRun(
  store: WorkflowRunReaderRepository,
  engine: WorkflowRunCanceler,
  schedule: ScheduleRecord,
): Promise<void> {
  if (schedule.lastRunId === undefined) {
    return;
  }
  const run = await store.getRun(schedule.lastRunId);
  if (run !== undefined && isActiveWorkflowRunStatus(run.status)) {
    await engine.cancelRun(schedule.lastRunId);
  }
}

export async function tickSchedules(
  store: WorkflowScheduleTickStore,
  engine: WorkflowScheduleTickEngine,
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
        defineWorkflowFromName(schedule.workflowName, schedule.workflowVersion),
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
      engine.observeScheduleRunCreated?.({
        scheduleId: schedule.id,
        runId: run.runId,
        workflowName: schedule.workflowName,
        ...(schedule.workflowVersion === undefined
          ? {}
          : { workflowVersion: schedule.workflowVersion }),
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
    ...(nextScheduleAt === undefined ? {} : { nextScheduleAt }),
  };
}

function scheduleRunContext(schedule: ScheduleRecord, fireAt: Temporal.Instant): unknown {
  if (schedule.context === undefined) {
    return {
      scheduleId: schedule.id,
      scheduleFireAt: fireAt.toString(),
    };
  }
  if (
    typeof schedule.context === "object" &&
    schedule.context !== null &&
    !Array.isArray(schedule.context) &&
    (Object.getPrototypeOf(schedule.context) === Object.prototype ||
      Object.getPrototypeOf(schedule.context) === null)
  ) {
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
