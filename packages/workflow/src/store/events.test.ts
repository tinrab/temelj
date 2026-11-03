import { createStorage } from "@temelj/storage";
import { describe, expect, test, vi } from "vitest";

import type { EventRecord, StepStartedEvent } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { RunRecord } from "../types/run.ts";
import type { WorkflowStorage } from "../types/store.ts";

import { createWorkflowClient } from "../client/create.ts";
import { implementWorkflow } from "../definition.ts";
import { makeEventsKey, makeRunKey, makeStepAttemptKey, stepAttemptKey } from "../store-keys.ts";
import { fakeStorage } from "../testing/fake-storage.ts";
import {
  eventHistoryStorageValue,
  readEventHistoryStorageValue,
} from "../testing/storage-values.ts";
import { createWorkflowStore } from "./create.ts";
import {
  appendEventWithProjectionPipelineIfRunCurrent,
  appendEventWithProjections,
} from "./events.ts";
import { toStorageValue } from "./storage-value.ts";

describe("workflow event append outcomes", () => {
  test.each(
    [
      workflowStarted(),
      { ...stepStarted(), timeoutAt: undefined },
      {
        kind: "step_failed",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:02Z"),
        stepId: "step-1",
        stepName: "load",
        attempt: 1,
        error: {
          name: "Error",
          message: "Step failed",
          stack: undefined,
          details: { reason: "unavailable", optional: undefined },
        },
      } satisfies EventRecord,
    ].flatMap((event) =>
      (
        [
          ["all", false],
          ["all", true],
          ["single-key", false],
          ["none", false],
        ] as const
      ).map(([conditionalWrites, guarded]) => ({ event, conditionalWrites, guarded })),
    ),
  )(
    "reconciles a committed $event.kind append with a lost acknowledgement ($conditionalWrites, guarded=$guarded)",
    async ({ event, conditionalWrites, guarded }) => {
      const storage = fakeStorage({ conditionalWrites });
      const run = workflowRun({ status: "running" });
      await storage.set(makeRunKey("test", run.id), toStorageValue(run));
      const key = makeEventsKey("test", run.id);
      const concurrent = messageSent();
      const set = storage.set.bind(storage);
      const failure = new Error("Committed append acknowledgement lost");
      let lost = false;

      async function lose() {
        lost = true;
        await set(key, toStorageValue([event, concurrent]));
        throw failure;
      }

      if (conditionalWrites === "all") {
        const compare = storage.compareAndSetMany.bind(storage);
        vi.spyOn(storage, "compareAndSetMany").mockImplementation(async (items) => {
          const committed = await compare(items);

          if (committed && !lost && items.some((item) => item.key === key)) await lose();

          return committed;
        });
      } else if (conditionalWrites === "single-key") {
        const compare = storage.compareAndSet.bind(storage);
        vi.spyOn(storage, "compareAndSet").mockImplementation(
          async (target, expected, value, options) => {
            const committed = await compare(target, expected, value, options);

            if (committed && !lost && target === key) await lose();

            return committed;
          },
        );
      } else {
        vi.spyOn(storage, "set").mockImplementation(async (target, value, options) => {
          await set(target, value, options);

          if (!lost && target === key) await lose();
        });
      }

      const appended = guarded
        ? await appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, event)
        : await appendEventWithProjections(storage, "test", run.id, event);

      expect(appended).toMatchObject(
        guarded ? { outcome: { status: "appended" } } : { status: "appended" },
      );
      expect(lost).toBe(true);
      expect(await readEventHistoryStorageValue(storage.get.bind(storage), key)).toEqual(
        toStorageValue([event, concurrent]),
      );
    },
  );

  test("completes a workflow after losing a step-start append acknowledgement", async () => {
    const storage = createStorage();
    const client = createWorkflowClient({ store: createWorkflowStore({ storage }) });
    const execute = vi.fn<() => string>(() => "done");

    const workflow = implementWorkflow(
      { name: "lost-step-acknowledgement", version: "v1" },
      ({ step }) => step.run({ name: "load" }, execute),
    );

    const compare = storage.compareAndSetMany.bind(storage);
    let lost = false;
    vi.spyOn(storage, "compareAndSetMany").mockImplementation(async (items) => {
      const committed = await compare(items);

      if (committed && !lost) {
        for (const item of items) {
          const events = await readEventHistoryStorageValue(storage.get.bind(storage), item.key);

          if (events.some((event) => event.kind === "step_started")) {
            lost = true;
            throw new Error("Committed step-start acknowledgement lost");
          }
        }
      }

      return committed;
    });

    try {
      const handle = await client.runs.start(workflow, undefined);
      await client.workers.processRun(handle.runId);
      expect(lost).toBe(true);
      expect((await client.runs.get(handle.runId))?.status).toBe("completed");
      expect(await handle.result()).toBe("done");
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });

  test("preserves the write failure when readback cannot confirm the committed prefix", async () => {
    const storage = createStorage();
    const failure = new Error("Unconfirmed write");
    vi.spyOn(storage, "compareAndSetMany").mockRejectedValue(failure);
    await expect(
      appendEventWithProjections(storage, "test", "run-1", workflowStarted()),
    ).rejects.toBe(failure);
  });

  test("does not confirm a different recorded event after a write failure", async () => {
    const storage = createStorage();
    const event = workflowStarted();
    const failure = new Error("Unconfirmed append");
    const key = makeEventsKey("test", "run-1");
    vi.spyOn(storage, "compareAndSetMany").mockImplementation(async () => {
      await storage.set(
        key,
        toStorageValue([{ ...event, timestamp: event.timestamp.add({ milliseconds: 1 }) }]),
      );
      throw failure;
    });
    await expect(appendEventWithProjections(storage, "test", "run-1", event)).rejects.toBe(failure);
  });

  test("preserves the write failure if reconciliation readback also fails", async () => {
    const storage = createStorage();
    const read = storage.get.bind(storage);
    const failure = new Error("Append failed");
    let writeFailed = false;
    vi.spyOn(storage, "compareAndSetMany").mockImplementation(async () => {
      writeFailed = true;
      throw failure;
    });
    vi.spyOn(storage, "get").mockImplementation(async (key) => {
      if (writeFailed) throw new Error("Readback failed");

      return await read(key);
    });
    await expect(
      appendEventWithProjections(storage, "test", "run-1", workflowStarted()),
    ).rejects.toBe(failure);
  });
  test("returns duplicate without appending a duplicate message idempotency event", async () => {
    const storage = createStorage();
    const event = messageSent();

    await expect(
      appendEventWithProjections(storage, "test", "run-1", event),
    ).resolves.toMatchObject({
      status: "appended",
      events: [event],
    });
    await expect(
      appendEventWithProjections(storage, "test", "run-1", { ...event }),
    ).resolves.toMatchObject({
      status: "duplicate",
      events: [event],
    });
    await expect(storage.get(makeEventsKey("test", "run-1"))).resolves.toEqual([event]);
  });

  test("returns duplicate through the run-current append path", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "running" });
    const event = messageSent();
    await storage.set(makeRunKey("test", run.id), toStorageValue(run));

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, event),
    ).resolves.toMatchObject({
      outcome: {
        status: "appended",
        events: [event],
      },
    });
    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, { ...event }),
    ).resolves.toMatchObject({
      outcome: {
        status: "duplicate",
        events: [event],
      },
    });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toEqual([event]);
  });

  test("returns staleRun without appending to a terminal run", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "completed" });

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, stepStarted()),
    ).resolves.toEqual({ outcome: { status: "staleRun" } });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toBeUndefined();
  });

  test("returns staleRun without appending when the stored run revision changed", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "running" });

    const newerRun = workflowRun({
      status: "running",
      updatedAt: Temporal.Instant.from("2025-01-01T00:00:02Z"),
    });

    await storage.set(makeRunKey("test", run.id), toStorageValue(newerRun));

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, workflowStarted()),
    ).resolves.toMatchObject({ outcome: { status: "staleRun" } });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toBeUndefined();
  });

  test("appends non-materialized events when the run revision is current", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "running" });
    const event = workflowStarted();
    await storage.set(makeRunKey("test", run.id), toStorageValue(run));

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, event),
    ).resolves.toMatchObject({
      outcome: {
        status: "appended",
        events: [event],
      },
    });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toEqual([event]);
  });

  test("appends materialized events and stores the step-attempt read model atomically", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "running" });
    const event = stepStarted();
    await storage.set(makeRunKey("test", run.id), toStorageValue(run));

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, event),
    ).resolves.toMatchObject({
      outcome: {
        status: "appended",
        events: [event],
      },
    });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toEqual([event]);
    await expect(
      storage.get(makeStepAttemptKey("test", run.id, stepAttemptKey("step-1", 1))),
    ).resolves.toMatchObject({
      runId: run.id,
      stepId: "step-1",
      stepName: "load",
      kind: "run",
      status: "running",
      attempt: 1,
      count: 1,
      createdAt: event.timestamp,
      startedAt: event.timestamp,
    });
  });

  test("rolls back an appended event when fallback materialization fails", async () => {
    const storage = failingStepAttemptStorage();
    const event = stepStarted();

    await expect(appendEventWithProjections(storage, "default", "run-1", event)).rejects.toThrow(
      "failed during set",
    );
    await expect(storage.get(makeEventsKey("default", "run-1"))).resolves.toEqual([]);
  });

  test("does not roll back fallback materialization failure after concurrent history append", async () => {
    const storage = concurrentAppendOnStepAttemptFailureStorage("run-1");
    const event = stepStarted();

    await expect(appendEventWithProjections(storage, "default", "run-1", event)).rejects.toThrow(
      "step attempt write failed after concurrent event append",
    );
    await expect(storage.get(makeEventsKey("default", "run-1"))).resolves.toMatchObject([
      { kind: "step_started" },
      { kind: "workflow_started" },
    ]);
  });
});

function workflowStarted(): EventRecord {
  return {
    kind: "workflow_started",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
  };
}

function stepStarted(): StepStartedEvent {
  return {
    kind: "step_started",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
    stepId: "step-1",
    stepName: "load",
    count: 1,
    attempt: 1,
  };
}

function messageSent(): EventRecord {
  return {
    kind: "message_sent",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    messageId: "ready",
    payload: "ok",
    idempotencyKey: "ready-key",
  };
}

function workflowRun(options: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    namespace: "test",
    workflowName: "append-outcomes",
    status: "pending",
    attempts: 0,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionReason: "created",
    ...options,
  };
}

/** Storage without atomic writes where every step-attempt write fails. */
function failingStepAttemptStorage(): WorkflowStorage {
  return fakeStorage({
    conditionalWrites: "none",
    engineSet: async (key, value, options, next) => {
      if (key.includes(":step-attempt:")) {
        throw new Error("step attempt write failed");
      }

      await next(key, value, options);
    },
  });
}

/** Like `failingStepAttemptStorage`, but another writer appends an event just before the failure. */
function concurrentAppendOnStepAttemptFailureStorage(runId: RunId): WorkflowStorage {
  let failed = false;

  const storage = fakeStorage({
    conditionalWrites: "none",
    set: async (key, value, options, next) => {
      if (!failed && key.includes(":step-attempt:")) {
        failed = true;
        const eventsKey = makeEventsKey("default", runId);

        const events = await readEventHistoryStorageValue(
          (eventKey) => storage.get(eventKey),
          eventsKey,
        );

        await next(
          eventsKey,
          eventHistoryStorageValue([
            ...events,
            {
              kind: "workflow_started",
              timestamp: Temporal.Instant.from("2026-06-07T10:00:01.000Z"),
            },
          ]),
          options,
        );
        throw new Error("step attempt write failed after concurrent event append");
      }

      await next(key, value, options);
    },
  });

  return storage;
}
