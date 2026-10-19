import type { WorkflowPage } from "../types/pagination.ts";
import type {
  ScheduleId,
  ListSchedulesOptions,
  ListSchedulesPageOptions,
  ScheduleRecord,
} from "../types/schedule.ts";
import type { WorkflowStorage } from "../types/store.ts";

import { omitUndefined, limitItems } from "../collection.ts";
import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowScheduleAlreadyExistsError, WorkflowScheduleError } from "../errors/mod.ts";
import { makeScheduleCursorKey, pageItems } from "../pagination.ts";
import { makeScheduleKey } from "../store-keys.ts";
import { querySchedules } from "./query.ts";
import { toStorageValue } from "./storage-value.ts";
import { isReadableScheduleRecord } from "./validation.ts";

export async function createSchedule(
  storage: WorkflowStorage,
  namespace: string,
  schedule: ScheduleRecord,
): Promise<ScheduleRecord> {
  if (schedule.namespace !== namespace) {
    WorkflowScheduleError.namespaceMismatch(schedule.namespace, namespace);
  }

  if (!isReadableScheduleRecord(schedule, namespace)) {
    throw new WorkflowScheduleError(
      "Workflow schedule record is invalid",
      WorkflowErrorCode.SCHEDULE_RECORD_INVALID,
      undefined,
    );
  }

  const compact = omitUndefined(schedule);

  const created = await storage.compareAndSet(
    makeScheduleKey(namespace, schedule.id),
    undefined,
    toStorageValue(compact),
  );

  if (!created) {
    throw new WorkflowScheduleAlreadyExistsError(schedule.id);
  }

  return compact;
}

export async function getReadableSchedule(
  storage: WorkflowStorage,
  namespace: string,
  scheduleId: ScheduleId,
): Promise<ScheduleRecord | undefined> {
  const schedule = await storage.get(makeScheduleKey(namespace, scheduleId));

  return isReadableScheduleRecord(schedule, namespace) ? schedule : undefined;
}

export async function updateScheduleIfCurrent(
  storage: WorkflowStorage,
  namespace: string,
  current: ScheduleRecord,
  next: ScheduleRecord,
): Promise<ScheduleRecord | undefined> {
  if (current.namespace !== namespace) {
    WorkflowScheduleError.namespaceMismatch(current.namespace, namespace);
  }

  if (next.namespace !== namespace) {
    WorkflowScheduleError.namespaceMismatch(next.namespace, namespace);
  }

  if (current.id !== next.id) {
    throw new WorkflowScheduleError(
      "Workflow schedule id cannot change",
      WorkflowErrorCode.SCHEDULE_ID_CHANGE_REJECTED,
      undefined,
    );
  }

  if (!isReadableScheduleRecord(current, namespace)) {
    throw new WorkflowScheduleError(
      "Current workflow schedule record is invalid",
      WorkflowErrorCode.SCHEDULE_CURRENT_RECORD_INVALID,
      undefined,
    );
  }

  if (!isReadableScheduleRecord(next, namespace)) {
    throw new WorkflowScheduleError(
      "Next workflow schedule record is invalid",
      WorkflowErrorCode.SCHEDULE_NEXT_RECORD_INVALID,
      undefined,
    );
  }

  const compact = omitUndefined(next);

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

  return limitItems(schedules, options?.limit);
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
