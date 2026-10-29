import { expect, test, vi } from "vitest";

import { defineWorkflow, implementWorkflow } from "../definition.ts";
import { WorkflowCapabilityError } from "../errors/mod.ts";
import { createWorkflowStore } from "../store/create.ts";
import { fakeStorage } from "../testing/fake-storage.ts";
import { createWorkflowClient } from "./create.ts";

test("conditionally cancels an exact run snapshot and rejects stale snapshots", async () => {
  const client = createWorkflowClient();
  try {
    const handle = await client.runs.start(
      defineWorkflow<string, string>({ name: "owned", version: "v1" }),
      "owner-a",
    );
    const snapshot = await client.runs.get(handle.runId);
    if (snapshot === undefined) throw new Error("Missing run");
    expect(await client.admin.cancelIfCurrent(snapshot)).toMatchObject({ status: "canceled" });
    expect(await client.admin.cancelIfCurrent(snapshot)).toBeUndefined();
    const canceled = await client.runs.get(handle.runId);
    if (canceled === undefined) throw new Error("Missing canceled run");
    expect(await client.admin.cancelIfCurrent(canceled)).toEqual(canceled);
  } finally {
    await client.close();
  }
});

test("requires conditional backend writes for snapshot cancellation", async () => {
  const client = createWorkflowClient({
    store: createWorkflowStore({ storage: fakeStorage({ conditionalWrites: "none" }) }),
  });
  try {
    const handle = await client.runs.start(
      defineWorkflow<string, string>({ name: "owned", version: "v1" }),
      "owner-a",
    );
    const snapshot = await client.runs.get(handle.runId);
    if (snapshot === undefined) throw new Error("Missing run");
    await expect(client.admin.cancelIfCurrent(snapshot)).rejects.toBeInstanceOf(
      WorkflowCapabilityError,
    );
    expect((await client.runs.get(handle.runId))?.status).toBe("pending");
  } finally {
    await client.close();
  }
});

test("does not cancel a run that completed after authorization", async () => {
  const client = createWorkflowClient();
  try {
    const work = implementWorkflow({ name: "owned", version: "v1" }, () => "done");
    const handle = await client.runs.start(work, undefined);
    const snapshot = await client.runs.get(handle.runId);
    if (snapshot === undefined) throw new Error("Missing run");
    await client.workers.processRun(handle.runId);
    expect(await client.admin.cancelIfCurrent(snapshot)).toBeUndefined();
    expect((await client.runs.get(handle.runId))?.status).toBe("completed");
  } finally {
    await client.close();
  }
});

test("does not cancel a changed owner when the update races its conditional write", async () => {
  const store = createWorkflowStore();
  const client = createWorkflowClient({ store });
  try {
    const handle = await client.runs.start(
      defineWorkflow<string, string>({ name: "owned", version: "v1" }),
      "owner-a",
    );
    const snapshot = await client.runs.get(handle.runId);
    if (snapshot === undefined) throw new Error("Missing run");
    const update = store.updateRunIfCurrent.bind(store);
    vi.spyOn(store, "updateRunIfCurrent").mockImplementationOnce(async (current, next) => {
      await store.updateRun({ ...current, input: "owner-b" });
      return await update(current, next);
    });
    expect(await client.admin.cancelIfCurrent(snapshot)).toBeUndefined();
    expect(await client.runs.get(handle.runId)).toMatchObject({
      input: "owner-b",
      status: "pending",
    });
  } finally {
    await client.close();
  }
});
