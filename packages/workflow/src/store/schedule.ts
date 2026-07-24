import type { StorageValue } from "@temelj/storage";

import type { WorkflowPage } from "../types/pagination.ts";
import type {
  ScheduleId,
  ListSchedulesOptions,
  ListSchedulesPageOptions,
  ScheduleRecord,
} from "../types/schedule.ts";
import type { WorkflowStorage } from "../types/store.ts";

import { WorkflowScheduleAlreadyExistsError, WorkflowScheduleError } from "../errors/mod.ts";
import { makeScheduleCursorKey, pageItems } from "../pagination.ts";
import { makeScheduleKey } from "../store-keys.ts";
import { limitWorkflowItems } from "../utility.ts";
import { compactWorkflowStoreRecord } from "./compaction.ts";
import { querySchedules } from "./query.ts";
import { toStorageValue } from "./storage-value.ts";
import { isReadableScheduleRecord } from "./validation.ts";

export async function createSchedule<TInput>(
  storage: WorkflowStorage,
  namespace: string,
  schedule: ScheduleRecord<TInput>,
): Promise<ScheduleRecord<TInput>> {
  if (schedule.namespace !== namespace) {
    WorkflowScheduleError.namespaceMismatch(schedule.namespace, namespace);
  }
  if (!isReadableScheduleRecord(schedule, namespace)) {
    WorkflowScheduleError.recordInvalid();
  }
  const compact = compactWorkflowStoreRecord(schedule);
  const created = await storage.compareAndSet(
    makeScheduleKey(namespace, schedule.id),
    undefined,
    toStorageValue(compact),
  );
  if (!created) {
    WorkflowScheduleAlreadyExistsError.alreadyExists(schedule.id);
  }
  return compact;
}

export async function getReadableSchedule<TInput = StorageValue>(
  storage: WorkflowStorage,
  namespace: string,
  scheduleId: ScheduleId,
): Promise<ScheduleRecord<TInput> | undefined> {
  const schedule = await storage.get(makeScheduleKey(namespace, scheduleId));
  return isReadableScheduleRecord<TInput>(schedule, namespace) ? schedule : undefined;
}

export async function updateScheduleIfCurrent<TInput>(
  storage: WorkflowStorage,
  namespace: string,
  current: ScheduleRecord,
  next: ScheduleRecord<TInput>,
): Promise<ScheduleRecord<TInput> | undefined> {
  if (current.namespace !== namespace) {
    WorkflowScheduleError.namespaceMismatch(current.namespace, namespace);
  }
  if (next.namespace !== namespace) {
    WorkflowScheduleError.namespaceMismatch(next.namespace, namespace);
  }
  if (current.id !== next.id) {
    WorkflowScheduleError.idChangeRejected();
  }
  if (!isReadableScheduleRecord(current, namespace)) {
    WorkflowScheduleError.currentRecordInvalid();
  }
  if (!isReadableScheduleRecord(next, namespace)) {
    WorkflowScheduleError.nextRecordInvalid();
  }
  const compact = compactWorkflowStoreRecord(next);
  const updated = await storage.compareAndSet(
    makeScheduleKey(namespace, current.id),
    toStorageValue(current),
    toStorageValue(compact),
  );
  return updated ? compact : undefined;
}

export async function listSchedules(
  storage: WorkflowStorage,
  namespace: string,
  options?: ListSchedulesOptions,
): Promise<readonly ScheduleRecord[]> {
  const schedules = await querySchedules(storage, namespace, options, {
    label: "Workflow schedule list options",
  });
  return limitWorkflowItems(schedules, options?.limit);
}

export async function listSchedulesPage(
  storage: WorkflowStorage,
  namespace: string,
  options?: ListSchedulesPageOptions,
): Promise<WorkflowPage<ScheduleRecord>> {
  const schedules = await querySchedules(
    storage,
    namespace,
    { ...options, limit: undefined },
    { label: "Workflow schedule page options" },
  );
  return pageItems(schedules, options, "Workflow schedule page", makeScheduleCursorKey);
}
