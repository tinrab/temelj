import { describe, expect, test } from "vitest";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { makeEventsKey, makeRunKey, makeWorkflowIdempotencyKey } from "../../src/store-keys.ts";
import { createWorkflowStore } from "../../src/store/create.ts";

describe("workflow namespaces", () => {
  test("isolates workflow stores by namespace over the same storage", async () => {
    const sharedStore = createWorkflowStore({ namespace: "shared" });
    const left = createWorkflowEngine({
      store: sharedStore,
      createRunId: () => "same_id",
    });
    const right = createWorkflowEngine({
      store: createWorkflowStore({
        storage: sharedStore.storage,
        namespace: "other",
      }),
      createRunId: () => "same_id",
    });
    const workflow = implementWorkflow({ name: "isolated" }, () => "ok");

    await left.startWorkflow(workflow, undefined, { idempotencyKey: "external_1" });
    await right.startWorkflow(workflow, undefined, { idempotencyKey: "external_1" });

    expect(await left.getRun("same_id")).toMatchObject({
      id: "same_id",
      workflowName: "isolated",
      status: "pending",
    });
    expect(await right.getRun("same_id")).toMatchObject({
      id: "same_id",
      workflowName: "isolated",
      status: "pending",
    });
    expect(await sharedStore.storage.keys({ prefix: "workflow:" })).toEqual([
      makeEventsKey("other", "same_id"),
      makeWorkflowIdempotencyKey("other", {
        workflowName: "isolated",
        idempotencyKey: "external_1",
      }),
      makeRunKey("other", "same_id"),
      makeEventsKey("shared", "same_id"),
      makeWorkflowIdempotencyKey("shared", {
        workflowName: "isolated",
        idempotencyKey: "external_1",
      }),
      makeRunKey("shared", "same_id"),
    ]);
  });
});
