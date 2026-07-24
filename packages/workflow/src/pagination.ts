import { decodeBase64UrlString, encodeBase64UrlString } from "@temelj/string";

import type {
  CursorKeyPart,
  CursorPayload,
  WorkflowPage,
  PageOptions,
} from "./types/pagination.ts";

import { WorkflowOptionsError } from "./errors/mod.ts";
import { workflowCursorPayloadSchema } from "./types/pagination.ts";
import { StepId } from "./types/step.ts";

const CURSOR_PREFIX = "wf-page:";
const DEFAULT_PAGE_LIMIT = 100;

export function pageItems<TItem>(
  items: readonly TItem[],
  options: PageOptions | undefined,
  label: string,
  cursorKey: (item: TItem, index: number) => readonly CursorKeyPart[],
): WorkflowPage<TItem> {
  const pageOptions = options ?? {};
  const limit = pageOptions.limit ?? DEFAULT_PAGE_LIMIT;
  const cursor = decodeCursor(pageOptions.cursor, label);
  const offset =
    cursor === undefined
      ? 0
      : items.findIndex((item, index) => compareCursorKeys(cursorKey(item, index), cursor) > 0);
  const start = offset === -1 ? items.length : offset;
  const pageItems = items.slice(start, start + limit);
  const nextOffset = start + pageItems.length;
  const hasMore = nextOffset < items.length;
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    ...(hasMore && last !== undefined
      ? { nextCursor: encodeCursor({ key: [...cursorKey(last, nextOffset - 1)] }) }
      : {}),
    hasMore,
  };
}

export function makeWorkflowRunCursorKey(run: {
  readonly createdAt: Temporal.Instant;
  readonly id: string;
}): readonly [number, string] {
  return [run.createdAt.epochMilliseconds, run.id] as const;
}

export function makeWorkflowEventCursorKey(_event: unknown, index: number): readonly [number] {
  return [index] as const;
}

export function makeWorkflowStepAttemptCursorKey(attempt: {
  readonly startedAt: Temporal.Instant;
  readonly stepId: StepId;
  readonly attempt: number;
}): readonly [number, StepId, number] {
  return [attempt.startedAt.epochMilliseconds, attempt.stepId, attempt.attempt] as const;
}

export function makeScheduleCursorKey(schedule: {
  readonly nextFireAt: Temporal.Instant;
  readonly createdAt: Temporal.Instant;
  readonly id: string;
}): readonly [number, number, string] {
  return [
    schedule.nextFireAt.epochMilliseconds,
    schedule.createdAt.epochMilliseconds,
    schedule.id,
  ] as const;
}

export function makeStreamChunkCursorKey(chunk: { readonly index: number }): readonly [number] {
  return [chunk.index] as const;
}

function encodeCursor(payload: CursorPayload): string {
  return `${CURSOR_PREFIX}${encodeBase64UrlString(JSON.stringify(payload))}`;
}

function decodeCursor(
  value: string | undefined,
  label: string,
): readonly CursorKeyPart[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value.startsWith(CURSOR_PREFIX)) {
    WorkflowOptionsError.cursorInvalid(label);
  }
  try {
    const parsed = workflowCursorPayloadSchema.safeParse(
      JSON.parse(decodeBase64UrlString(value.slice(CURSOR_PREFIX.length))),
    );
    if (!parsed.success) {
      WorkflowOptionsError.cursorInvalid(label);
    }
    return parsed.data.key;
  } catch (error) {
    if (!(error instanceof WorkflowOptionsError)) {
      WorkflowOptionsError.cursorInvalid(label);
    }
    throw error;
  }
}

function compareCursorKeys(left: readonly unknown[], right: readonly unknown[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftPart = left[index];
    const rightPart = right[index];
    const compared =
      leftPart === rightPart
        ? 0
        : leftPart === undefined
          ? -1
          : rightPart === undefined
            ? 1
            : typeof leftPart === "number" &&
                Number.isFinite(leftPart) &&
                typeof rightPart === "number" &&
                Number.isFinite(rightPart)
              ? leftPart - rightPart
              : String(leftPart).localeCompare(String(rightPart));
    if (compared !== 0) {
      return compared;
    }
  }
  return 0;
}
