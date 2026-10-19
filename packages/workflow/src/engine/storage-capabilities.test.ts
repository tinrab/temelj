import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { implementWorkflow } from "../definition.ts";
import { makeMessageIdempotencyKey, makeStepAttemptKey, stepAttemptKey } from "../store-keys.ts";
import { WorkflowStore } from "../store/create.ts";
import { fakeStorage } from "../testing/fake-storage.ts";
import { storageBackendImports, workflowRuntimeSourceFiles } from "../testing/metadata.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow storage capabilities", () => {
  test("runtime source imports only generic storage", () => {
    expect(
      workflowRuntimeSourceFiles().flatMap((file) =>
        storageBackendImports(readFileSync(file, "utf8")).map((specifier) => ({
          file,
          specifier,
        })),
      ),
    ).toEqual([]);
  });

  test("best-effort storage reports weak capabilities and executes single-process runs", async () => {
    const storage = fakeStorage({ conditionalWrites: "none" });
    const store = new WorkflowStore({ storage });

    const engine = createWorkflowEngine({
      store,
      createRunId: () => "run_best_effort_storage",
    });

    const workflow = implementWorkflow<undefined, string>(
      { name: "best-effort-storage" },
      async ({ step }) => {
        return await step.run({ name: "work" }, () => "done");
      },
    );

    expect(store.capabilities).toMatchObject({
      conditionalWrites: false,
      conditionalRunClaims: false,
      conditionalRunUpdates: false,
      conditionalRunLeaseExtensions: false,
      conditionalRunLeaseReleases: false,
      conditionalEventAppends: false,
      conditionalStepAttemptMaterialization: false,
      atomicRunCreation: false,
      atomicEventAndStepAttemptMaterialization: false,
      messageIdempotencyIndexes: true,
      indexedRunQueries: false,
      indexedRunCounts: false,
      indexedClaimableRunQueries: false,
      indexedStepAttemptQueries: false,
      indexedScheduleQueries: false,
      indexedLockQueries: false,
      rollsBackEventsOnMaterializationFailure: true,
      reconcilesStepAttemptsFromEvents: true,
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(engine.store.listStepAttempts("run_best_effort_storage")).resolves.toMatchObject([
      {
        stepId: "run:work",
        status: "completed",
        output: "done",
      },
    ]);
  });

  test("single-key conditional storage reports non-atomic batches and materializes attempts", async () => {
    const storage = fakeStorage({ conditionalWrites: "single-key" });
    const store = new WorkflowStore({ storage });

    const engine = createWorkflowEngine({
      store,
      createRunId: () => "run_single_key_conditional_storage",
    });

    const workflow = implementWorkflow<undefined, string>(
      { name: "single-key-conditional-storage" },
      async ({ step }) => {
        await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));

        return await step.run({ name: "work" }, () => "done");
      },
    );

    expect(store.capabilities).toMatchObject({
      conditionalWrites: true,
      conditionalRunClaims: true,
      conditionalRunUpdates: true,
      conditionalRunLeaseExtensions: true,
      conditionalRunLeaseReleases: true,
      conditionalEventAppends: true,
      conditionalStepAttemptMaterialization: true,
      atomicRunCreation: false,
      atomicEventAndStepAttemptMaterialization: false,
      messageIdempotencyIndexes: true,
      indexedRunQueries: false,
      indexedRunCounts: false,
      indexedClaimableRunQueries: false,
      indexedStepAttemptQueries: false,
      indexedScheduleQueries: false,
      indexedLockQueries: false,
      rollsBackEventsOnMaterializationFailure: true,
      reconcilesStepAttemptsFromEvents: true,
    });

    const waiting = await engine.runWorkflowNow(workflow, undefined);
    expect(waiting.kind).toBe("waiting");
    await expect(
      engine.store.getEvents("run_single_key_conditional_storage"),
    ).resolves.toMatchObject([
      { kind: "workflow_started" },
      { kind: "sleep_started", stepId: "sleep:pause" },
    ]);
    await expect(
      engine.store.listStepAttempts("run_single_key_conditional_storage"),
    ).resolves.toEqual([
      expect.objectContaining({
        stepId: "sleep:pause",
        status: "running",
      }),
    ]);
  });

  test("repairs materialized step attempts from event history", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_repair_step_attempts",
    });

    const workflow = implementWorkflow<undefined, string>(
      { name: "repair-step-attempts" },
      async ({ step }) => await step.run({ name: "work" }, () => "done"),
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    const attemptKey = makeStepAttemptKey(
      "default",
      "run_repair_step_attempts",
      stepAttemptKey("run:work", 1),
    );

    await engine.storage.delete(attemptKey);
    await expect(engine.storage.get(attemptKey)).resolves.toBeUndefined();

    await expect(
      engine.store.repairStepAttempts("run_repair_step_attempts"),
    ).resolves.toMatchObject([
      {
        runId: "run_repair_step_attempts",
        stepId: "run:work",
        status: "completed",
        output: "done",
      },
    ]);
    await expect(engine.storage.get(attemptKey)).resolves.toMatchObject({
      runId: "run_repair_step_attempts",
      stepId: "run:work",
      status: "completed",
      output: "done",
    });
  });

  test("repairs message idempotency indexes from event history", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_repair_message_idempotency",
    });

    const workflow = implementWorkflow<undefined, string>(
      { name: "repair-message-idempotency" },
      async ({ run, step }) => {
        await step.message.send(run.id, {
          messageId: "ready",
          payload: "ok",
          idempotencyKey: "ready-key",
        });

        return "sent";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "sent",
    });

    const indexKey = makeMessageIdempotencyKey(
      "default",
      "run_repair_message_idempotency",
      "ready-key",
    );

    await engine.storage.delete(indexKey);
    await expect(engine.storage.get(indexKey)).resolves.toBeUndefined();

    await expect(
      engine.store.repairMessageIdempotencyIndexes("run_repair_message_idempotency"),
    ).resolves.toMatchObject([
      {
        runId: "run_repair_message_idempotency",
        messageId: "ready",
      },
    ]);
    await expect(engine.storage.get(indexKey)).resolves.toMatchObject({
      runId: "run_repair_message_idempotency",
      messageId: "ready",
    });
  });
});
